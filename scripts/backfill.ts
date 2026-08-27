/**
 * Carga inicial do Sistema Sam Farma.
 *
 * Lê os arquivos que o cliente enviou e popula o banco:
 *   1. De-Para do arquivo da DRE  → plano de contas (Account.erpKey → categoria)
 *   2. Base_Recebimentos (jan–jul) → receita por canal, REALIZADO
 *   3. Base_Pagamentos  (jan–jul)  → pagamentos, REALIZADO
 *   4. Contas a Pagar do mês       → REALIZADO + PENDENTE
 *   5. Recebidos e Recebíveis      → recebido (DRE) + a receber (projetado)
 *
 * Reexecutar é seguro: tudo é gravado com `fitid` único e `skipDuplicates`.
 *
 * Uso: node .backfill-out/scripts/backfill.js "<pasta com os xlsx>"
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { parsePagamentos, parseRecebimentos, nomeCurtoErp, codigoErp } from '../src/lib/erp-import'
import { CAT, isValidDreGroup, typeForGroup } from '../src/lib/dre'
import { nomeUnidade } from '../src/lib/erp-sync'

const prisma = new PrismaClient({ log: ['error'] })

const ARQ_DRE = 'DRE_Gerencial_SamFarma_AtéJulho2026.xlsx'
const ARQ_PAGAR = ['ContasaPagarAgosto.xlsx', 'ContasaPagarSetembro-Dezembro.xlsx']
const ARQ_RECEBER = 'Recebidos e Recebíveis 2026.xlsx'

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function lerAba(caminho: string, aba?: string): string[][] {
  const wb = XLSX.readFile(caminho, { cellDates: false, cellFormula: false, cellStyles: false, ...(aba ? { sheets: [aba] } : {}) })
  const nome = aba ?? wb.SheetNames[0]
  const sheet = wb.Sheets[nome]
  if (!sheet) throw new Error('Aba não encontrada: ' + nome)
  const dados = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '', raw: false })
  return dados.map(linha => (linha as unknown[]).map(c => String(c ?? '').trim()))
}

/** A Base_Pagamentos do arquivo da DRE traz datas em M/D/AA — normaliza para DD/MM/AAAA. */
function normalizarDatasMDY(matrix: string[][], colunas: number[]): string[][] {
  return matrix.map((linha, i) => {
    if (i === 0) return linha
    const copia = linha.slice()
    colunas.forEach(c => {
      const m = String(copia[c] ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
      if (!m) return
      const mes = +m[1], dia = +m[2]
      const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3]
      copia[c] = String(dia).padStart(2, '0') + '/' + String(mes).padStart(2, '0') + '/' + ano
    })
    return copia
  })
}

async function proximoCodigo(prefixo: string): Promise<string> {
  const existentes = await prisma.account.findMany({
    where: { code: { startsWith: prefixo + '.' } },
    select: { code: true },
  })
  const nums = existentes.map(a => parseInt(a.code.split('.').pop() || '0') || 0)
  return prefixo + '.' + String((nums.length ? Math.max.apply(null, nums) : 0) + 1).padStart(2, '0')
}

// ── 1. De-Para → plano de contas ──────────────────────────────────────
async function carregarDePara(pasta: string) {
  const matrix = lerAba(pasta + '/' + ARQ_DRE, 'De-Para')
  let criadas = 0, atualizadas = 0, invalidas = 0
  const usados = new Set<string>()

  for (let r = 2; r < matrix.length; r++) {
    const chave = String(matrix[r][0] ?? '').trim()
    const categoria = String(matrix[r][1] ?? '').trim()
    if (!chave || !categoria) continue
    if (!isValidDreGroup(categoria)) { invalidas++; continue }

    const existente = await prisma.account.findUnique({ where: { erpKey: chave } })
    if (existente) {
      if (existente.dreGroup !== categoria) {
        await prisma.account.update({
          where: { id: existente.id },
          data: { dreGroup: categoria, type: typeForGroup(categoria) },
        })
        atualizadas++
      }
      continue
    }

    const nativo = codigoErp(chave)
    let code = nativo && !usados.has(nativo) ? nativo : await proximoCodigo('9.1')
    if (await prisma.account.findUnique({ where: { code } })) code = await proximoCodigo('9.1')
    usados.add(code)

    await prisma.account.create({
      data: { code, name: nomeCurtoErp(chave), erpKey: chave, dreGroup: categoria, type: typeForGroup(categoria) },
    })
    criadas++
  }
  console.log('De-Para: ' + criadas + ' contas criadas, ' + atualizadas + ' atualizadas, ' + invalidas + ' categorias fora da estrutura')
}

// ── 2. Unidades ───────────────────────────────────────────────────────
async function garantirUnidades(refs: { apelido: string; codigo: string }[]): Promise<Record<string, number>> {
  const mapa: Record<string, number> = {}
  const nomes = new Map<string, { apelido: string; codigo: string }>()
  refs.forEach(r => {
    const nome = nomeUnidade(r.apelido, r.codigo)
    if (!nomes.has(nome)) nomes.set(nome, r)
  })
  for (const [nome, ref] of Array.from(nomes.entries())) {
    let unidade = await prisma.unit.findFirst({ where: { name: nome } })
    if (!unidade) unidade = await prisma.unit.create({ data: { name: nome } })
    mapa[nome] = unidade.id
    if (ref.apelido) mapa[ref.apelido] = unidade.id
    if (ref.codigo) mapa[ref.codigo] = unidade.id
  }
  return mapa
}

// ── 3. Pagamentos ─────────────────────────────────────────────────────
async function carregarPagamentos(matrix: string[][], nomeArquivo: string) {
  const r = parsePagamentos(matrix, nomeArquivo)
  if (r.rows.length === 0) { console.log(nomeArquivo + ': nenhum título'); return }

  const unidades = await garantirUnidades(r.rows.map(t => ({ apelido: t.unidadeApelido, codigo: t.unidade })))

  // Contas do De-Para; chave nova entra como "A Classificar"
  const contas: Record<string, number> = {}
  const existentes = await prisma.account.findMany({ where: { erpKey: { in: r.erpKeys } } })
  existentes.forEach(a => { if (a.erpKey) contas[a.erpKey] = a.id })
  let novas = 0
  for (const chave of r.erpKeys) {
    if (contas[chave]) continue
    const nativo = codigoErp(chave)
    let code = nativo || await proximoCodigo('9.1')
    if (await prisma.account.findUnique({ where: { code } })) code = await proximoCodigo('9.1')
    const criada = await prisma.account.create({
      data: {
        code,
        name: nomeCurtoErp(chave),
        erpKey: chave,
        dreGroup: CAT.A_CLASSIFICAR,
        type: typeForGroup(CAT.A_CLASSIFICAR),
      },
    })
    contas[chave] = criada.id
    novas++
  }

  const data = r.rows.map(t => ({
    fitid: t.fitid,
    date: new Date(t.pagamento ?? t.vencimento),
    dueDate: new Date(t.vencimento),
    description: t.credor,
    memo: [t.credor, t.documento].filter(Boolean).join(' · '),
    amount: t.valor,
    month: t.month,
    year: t.year,
    status: t.status,
    accountId: t.erpKey ? contas[t.erpKey] ?? null : null,
    unitId: unidades[t.unidadeApelido] ?? unidades[t.unidade] ?? null,
  }))

  const res = await prisma.transaction.createMany({ data, skipDuplicates: true })
  console.log(
    nomeArquivo + ': ' + res.count + ' gravados (' + (r.rows.length - res.count) + ' já existiam) · ' +
    'realizado R$ ' + brl(r.totalRealizado) + ' · pendente R$ ' + brl(r.totalPendente) +
    (novas ? ' · ' + novas + ' chaves novas em A Classificar' : '')
  )
}

// ── 4. Recebimentos ───────────────────────────────────────────────────
async function carregarRecebimentos(matrix: string[][], nomeArquivo: string, ano: number) {
  const r = parseRecebimentos(matrix, nomeArquivo, ano)
  if (r.rows.length === 0) { console.log(nomeArquivo + ': nenhum recebimento'); return }

  const canais = Array.from(new Set(r.rows.map(t => t.canal)))
  const contas: Record<string, number> = {}
  for (const canal of canais) {
    let conta = await prisma.account.findFirst({ where: { name: canal, dreGroup: CAT.RECEITA } })
    if (!conta) {
      conta = await prisma.account.create({
        data: { code: await proximoCodigo('1.1'), name: canal, dreGroup: CAT.RECEITA, type: typeForGroup(CAT.RECEITA) },
      })
    }
    contas[canal.toLowerCase()] = conta.id
  }

  const data = r.rows.map(t => {
    const fim = new Date(t.year, t.month, 0)
    return {
      fitid: t.fitid,
      date: fim,
      dueDate: fim,
      description: t.canal,
      memo: t.canal + ' · ' + (t.status === 'PENDENTE' ? 'a receber' : 'recebido'),
      amount: Math.abs(t.valor),
      month: t.month,
      year: t.year,
      status: t.status,
      accountId: contas[t.canal.toLowerCase()] ?? null,
      unitId: null,
    }
  })

  const res = await prisma.transaction.createMany({ data, skipDuplicates: true })
  console.log(
    nomeArquivo + ': ' + res.count + ' gravados (' + (r.rows.length - res.count) + ' já existiam) · ' +
    'recebido R$ ' + brl(r.totalRealizado) + ' · a receber R$ ' + brl(r.totalPendente)
  )
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  const pasta = process.argv[2]
  if (!pasta) { console.error('Informe a pasta com os arquivos .xlsx'); process.exit(1) }

  console.log('== 1. De-Para')
  await carregarDePara(pasta)

  console.log('\n== 2. Histórico jan–jul (arquivo da DRE)')
  const basePag = normalizarDatasMDY(lerAba(pasta + '/' + ARQ_DRE, 'Base_Pagamentos'), [3, 8, 19, 20])
  await carregarPagamentos(basePag, 'Base_Pagamentos_jan_jul')
  await carregarRecebimentos(lerAba(pasta + '/' + ARQ_DRE, 'Base_Recebimentos'), 'Base_Recebimentos_jan_jul', 2026)

  console.log('\n== 3. Contas a pagar do período corrente e futuro')
  for (const arq of ARQ_PAGAR) {
    await carregarPagamentos(lerAba(pasta + '/' + arq), arq)
  }

  console.log('\n== 4. Recebidos e recebíveis')
  await carregarRecebimentos(lerAba(pasta + '/' + ARQ_RECEBER), ARQ_RECEBER, 2026)

  const total = await prisma.transaction.count()
  const contas = await prisma.account.count()
  const unidades = await prisma.unit.count()
  console.log('\n== Banco: ' + total + ' lançamentos · ' + contas + ' contas · ' + unidades + ' unidades')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
