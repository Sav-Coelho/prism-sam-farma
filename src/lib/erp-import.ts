/**
 * Leitura dos arquivos que o analista exporta todo mês.
 *
 * Dois formatos reconhecidos automaticamente:
 *
 * 1. **Contas a Pagar** (export do ERP) — uma linha por título, com a coluna
 *    "Plano de Contas" já classificada pelo ERP. Essa string é a chave do
 *    De-Para (`Account.erpKey`), então a classificação é automática.
 *    `Status = Paga` vira lançamento REALIZADO (competência = Data Pagamento);
 *    `Pendente` vira PENDENTE (competência = Data de Vencimento) e alimenta o
 *    fluxo de caixa projetado.
 *
 * 2. **Recebidos e Recebíveis** — matriz por canal e mês, em blocos
 *    ("Contas a receber Agosto" → colunas "recebidos" / "a receber").
 *    Aceita também o formato normalizado (Competência · Canal · Valor).
 */
import { parseDateBR, parseNumberBR } from './import-mapper'
import { findCol } from './spreadsheet'

export type FileKind = 'pagamentos' | 'recebimentos' | 'desconhecido'

export interface PagamentoRow {
  fitid: string
  erpKey: string
  credor: string
  documento: string
  unidade: string
  unidadeApelido: string
  banco: string
  valor: number
  vencimento: string          // ISO
  pagamento: string | null    // ISO — null quando ainda não foi paga
  status: 'REALIZADO' | 'PENDENTE'
  month: number
  year: number
}

export interface RecebimentoRow {
  fitid: string
  canal: string
  valor: number
  status: 'REALIZADO' | 'PENDENTE'
  month: number
  year: number
}

export interface PagamentosResult {
  kind: 'pagamentos'
  rows: PagamentoRow[]
  erpKeys: string[]
  errors: string[]
  totalRealizado: number
  totalPendente: number
}

export interface RecebimentosResult {
  kind: 'recebimentos'
  rows: RecebimentoRow[]
  errors: string[]
  totalRealizado: number
  totalPendente: number
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** "março" → 3 (aceita com e sem cedilha) */
function mesPorNome(nome: string): number {
  const i = MESES.indexOf(nome.toLowerCase().trim())
  if (i < 0) return 0
  return i <= 2 ? i + 1 : i   // 'marco' é duplicata de 'março'
}

/** Identifica o tipo do arquivo pelo cabeçalho. */
export function sniffKind(matrix: string[][]): FileKind {
  const head = matrix.slice(0, 15).map(r => r.join(' | ').toLowerCase()).join('\n')
  if (head.includes('plano de contas') && (head.includes('credor') || head.includes('vencimento'))) {
    return 'pagamentos'
  }
  if (/contas? a receber/i.test(head) || (head.includes('canal') && head.includes('compet'))) {
    return 'recebimentos'
  }
  return 'desconhecido'
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

function slug(s: string, max: number): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').slice(0, max).toLowerCase()
}

// ── Contas a Pagar ────────────────────────────────────────────────────

const COLS_PAG = {
  status:     ['status'],
  unidade:    ['unidade'],
  credor:     ['credor'],
  vencimento: ['data de vencimento', 'vencimento'],
  valor:      ['valor'],            // col "Valor" — é a que a DRE do cliente soma
  plano:      ['plano de contas'],
  pagamento:  ['data pagamento', 'data de pagamento'],
  apelido:    ['apelido un. neg.', 'apelido'],
  banco:      ['retiradas pagamento'],
  documento:  ['número documento', 'numero documento', 'documento'],
}

export function parsePagamentos(matrix: string[][], fileName: string): PagamentosResult {
  // O cabeçalho é a primeira linha que tem "Plano de Contas"
  let hdrRow = 0
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    if (matrix[r].some(c => c.toLowerCase().trim() === 'plano de contas')) { hdrRow = r; break }
  }
  const headers = matrix[hdrRow] ?? []
  const col = {
    status:     findCol(headers, COLS_PAG.status),
    unidade:    findCol(headers, COLS_PAG.unidade),
    credor:     findCol(headers, COLS_PAG.credor),
    vencimento: findCol(headers, COLS_PAG.vencimento),
    valor:      findCol(headers, COLS_PAG.valor),
    plano:      findCol(headers, COLS_PAG.plano),
    pagamento:  findCol(headers, COLS_PAG.pagamento),
    apelido:    findCol(headers, COLS_PAG.apelido),
    banco:      findCol(headers, COLS_PAG.banco),
    documento:  findCol(headers, COLS_PAG.documento),
  }

  const rows: PagamentoRow[] = []
  const errors: string[] = []
  const erpKeys: string[] = []
  const vistos: Record<string, number> = {}
  const arq = slug(fileName.replace(/\.[^.]+$/, ''), 12) || 'pag'

  for (let r = hdrRow + 1; r < matrix.length; r++) {
    const linha = matrix[r]
    const credor = String(linha[col.credor] ?? '').trim()
    const rawValor = String(linha[col.valor] ?? '').trim()
    if (!credor && !rawValor) continue

    const valor = parseNumberBR(rawValor)
    if (isNaN(valor) || valor === 0) {
      errors.push('Linha ' + (r + 1) + ': valor inválido "' + rawValor + '"')
      continue
    }

    const venc = parseDateBR(String(linha[col.vencimento] ?? ''))
    const pago = col.pagamento >= 0 ? parseDateBR(String(linha[col.pagamento] ?? '')) : null
    const statusTxt = String(linha[col.status] ?? '').trim().toLowerCase()
    // Paga com data de pagamento = realizado; o resto vai para o projetado
    const realizado = statusTxt.startsWith('paga') && !!pago
    const competencia = realizado ? pago! : venc

    if (!competencia) {
      errors.push('Linha ' + (r + 1) + ': sem data de ' + (realizado ? 'pagamento' : 'vencimento'))
      continue
    }

    // Quando o ERP não traz Plano de Contas, a chave do De-Para é o próprio
    // credor — é assim que o cliente classifica essas linhas na planilha.
    const plano = String(linha[col.plano] ?? '').trim()
    const erpKey = plano || credor
    if (erpKey) erpKeys.push(erpKey)

    const unidade = String(linha[col.unidade] ?? '').trim()
    const doc = col.documento >= 0 ? String(linha[col.documento] ?? '').trim() : ''
    const dataKey = competencia.getFullYear() + pad(competencia.getMonth() + 1, 2) + pad(competencia.getDate(), 2)
    const base = 'sf_pag_' + arq + '_' + slug(unidade || 'x', 4) + '_' + slug(doc || credor, 10) + '_' + dataKey + '_' + pad(Math.round(Math.abs(valor) * 100), 9)
    vistos[base] = (vistos[base] || 0) + 1

    rows.push({
      fitid: base + '_' + pad(vistos[base], 3),
      erpKey,
      credor: credor || 'Sem credor',
      documento: doc,
      unidade,
      unidadeApelido: col.apelido >= 0 ? String(linha[col.apelido] ?? '').trim() : '',
      banco: col.banco >= 0 ? String(linha[col.banco] ?? '').replace(/\s*\(R\$.*/, '').trim() : '',
      valor: -Math.abs(valor),          // contas a pagar são sempre saída
      vencimento: (venc ?? competencia).toISOString(),
      pagamento: pago ? pago.toISOString() : null,
      status: realizado ? 'REALIZADO' : 'PENDENTE',
      month: competencia.getMonth() + 1,
      year: competencia.getFullYear(),
    })
  }

  const soma = (s: 'REALIZADO' | 'PENDENTE') =>
    rows.filter(t => t.status === s).reduce((acc, t) => acc + Math.abs(t.valor), 0)

  return {
    kind: 'pagamentos',
    rows,
    erpKeys: Array.from(new Set(erpKeys)),
    errors,
    totalRealizado: soma('REALIZADO'),
    totalPendente: soma('PENDENTE'),
  }
}

// ── Recebidos e Recebíveis ────────────────────────────────────────────

/** Formato normalizado: Competência (ou Ano+Mês) · Canal · Valor. */
function parseRecebimentosNormalizado(matrix: string[][], fileName: string): RecebimentosResult | null {
  let hdrRow = -1
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const h = matrix[r].map(c => c.toLowerCase())
    if (h.some(c => c.includes('canal')) && h.some(c => c.includes('valor'))) { hdrRow = r; break }
  }
  if (hdrRow < 0) return null

  const headers = matrix[hdrRow]
  const cCanal = findCol(headers, ['canal'])
  const cValor = findCol(headers, ['valor (r$)', 'valor'])
  const cComp = findCol(headers, ['competência (aaaamm)', 'competência', 'competencia'])
  const cAno = findCol(headers, ['ano'])
  const cMes = findCol(headers, ['mês', 'mes'])
  const cStatus = findCol(headers, ['status', 'situação', 'situacao'])

  const rows: RecebimentoRow[] = []
  const errors: string[] = []
  const vistos: Record<string, number> = {}
  const arq = slug(fileName.replace(/\.[^.]+$/, ''), 12) || 'rec'

  for (let r = hdrRow + 1; r < matrix.length; r++) {
    const linha = matrix[r]
    const canal = String(linha[cCanal] ?? '').trim()
    if (!canal) continue
    const valor = parseNumberBR(String(linha[cValor] ?? '').replace(/^R+\$?/i, ''))
    if (isNaN(valor) || valor === 0) continue

    let month = 0, year = 0
    if (cComp >= 0) {
      const comp = String(linha[cComp] ?? '').replace(/\D/g, '')
      if (comp.length === 6) { year = parseInt(comp.slice(0, 4)); month = parseInt(comp.slice(4, 6)) }
    }
    if ((!month || !year) && cAno >= 0 && cMes >= 0) {
      year = parseInt(String(linha[cAno] ?? '')) || 0
      month = parseInt(String(linha[cMes] ?? '')) || 0
    }
    if (!month || !year) {
      errors.push('Linha ' + (r + 1) + ': competência inválida')
      continue
    }

    const statusTxt = cStatus >= 0 ? String(linha[cStatus] ?? '').toLowerCase() : ''
    const status: 'REALIZADO' | 'PENDENTE' = statusTxt.includes('receber') ? 'PENDENTE' : 'REALIZADO'
    const base = 'sf_rec_' + arq + '_' + year + pad(month, 2) + '_' + slug(canal, 14) + '_' + (status === 'PENDENTE' ? 'p' : 'r')
    vistos[base] = (vistos[base] || 0) + 1

    rows.push({
      fitid: base + (vistos[base] > 1 ? '_' + pad(vistos[base], 2) : ''),
      canal: canalCanonico(canal),
      valor: Math.abs(valor),
      status,
      month,
      year,
    })
  }

  if (rows.length === 0) return null
  return finalizarRecebimentos(rows, errors)
}

/**
 * Formato em matriz: células "Contas a receber <Mês>" abrem um bloco, a linha
 * seguinte diz "recebidos"/"a receber" e as linhas abaixo trazem canal + valores.
 */
function parseRecebimentosMatriz(matrix: string[][], fileName: string, anoPadrao: number): RecebimentosResult | null {
  const rows: RecebimentoRow[] = []
  const errors: string[] = []
  const vistos: Record<string, number> = {}
  const arq = slug(fileName.replace(/\.[^.]+$/, ''), 12) || 'rec'

  const blocos: { row: number; col: number; month: number; year: number }[] = []
  matrix.forEach((linha, r) => {
    linha.forEach((cel, c) => {
      const m = String(cel).match(/(?:contas?\s+a\s+receber|recebimentos?)\s+(?:de\s+)?([a-zçã]+)\s*\/?\s*(\d{2,4})?/i)
      if (!m) return
      const mes = mesPorNome(m[1])
      if (!mes) return
      let ano = anoPadrao
      if (m[2]) ano = m[2].length === 2 ? 2000 + parseInt(m[2]) : parseInt(m[2])
      blocos.push({ row: r, col: c, month: mes, year: ano })
    })
  })
  if (blocos.length === 0) return null

  // Blocos ficam lado a lado: a janela de um termina onde a coluna do próximo começa
  const colunas = Array.from(new Set(blocos.map(b => b.col))).sort((a, b) => a - b)

  for (const bloco of blocos) {
    // Sub-cabeçalho (recebidos / a receber) na linha seguinte, na janela do bloco
    const sub = matrix[bloco.row + 1] ?? []
    const idx = colunas.indexOf(bloco.col)
    const janelaIni = idx > 0
      ? Math.max(bloco.col - 1, colunas[idx - 1] + 1)
      : Math.max(0, bloco.col - 1)
    const janelaFim = idx + 1 < colunas.length ? colunas[idx + 1] - 1 : bloco.col + 2
    const statusPorCol: Record<number, 'REALIZADO' | 'PENDENTE'> = {}
    for (let c = janelaIni; c <= janelaFim; c++) {
      const t = String(sub[c] ?? '').toLowerCase().trim()
      if (!t) continue
      if (t.includes('a receber')) statusPorCol[c] = 'PENDENTE'
      else if (t.includes('receb')) statusPorCol[c] = 'REALIZADO'
    }
    // Sem sub-cabeçalho legível: a primeira coluna de valor é considerada recebida
    const semSub = Object.keys(statusPorCol).length === 0

    for (let r = bloco.row + 2; r < matrix.length; r++) {
      const linha = matrix[r] ?? []
      // Um novo bloco na mesma janela encerra o atual
      if (blocos.some(b => b.row === r && b.col >= janelaIni && b.col <= janelaFim)) break

      let canal = ''
      let canalCol = -1
      for (let c = janelaIni; c <= janelaFim; c++) {
        const v = String(linha[c] ?? '').trim()
        if (v && isNaN(parseNumberBR(v))) { canal = v; canalCol = c; break }
      }
      if (!canal) continue

      for (let c = canalCol + 1; c <= janelaFim; c++) {
        const valor = parseNumberBR(String(linha[c] ?? ''))
        if (isNaN(valor) || valor === 0) continue
        const status = statusPorCol[c] ?? (semSub && c === canalCol + 1 ? 'REALIZADO' : statusPorCol[c] ?? 'PENDENTE')
        const base = 'sf_rec_' + arq + '_' + bloco.year + pad(bloco.month, 2) + '_' + slug(canal, 14) + '_' + (status === 'PENDENTE' ? 'p' : 'r')
        vistos[base] = (vistos[base] || 0) + 1
        rows.push({
          fitid: base + (vistos[base] > 1 ? '_' + pad(vistos[base], 2) : ''),
          canal: canalCanonico(canal),
          valor: Math.abs(valor),
          status,
          month: bloco.month,
          year: bloco.year,
        })
      }
    }
  }

  if (rows.length === 0) return null
  return finalizarRecebimentos(rows, errors)
}

function finalizarRecebimentos(rows: RecebimentoRow[], errors: string[]): RecebimentosResult {
  const soma = (s: 'REALIZADO' | 'PENDENTE') =>
    rows.filter(t => t.status === s).reduce((acc, t) => acc + t.valor, 0)
  return {
    kind: 'recebimentos',
    rows,
    errors,
    totalRealizado: soma('REALIZADO'),
    totalPendente: soma('PENDENTE'),
  }
}

export function parseRecebimentos(matrix: string[][], fileName: string, anoPadrao: number): RecebimentosResult {
  return parseRecebimentosNormalizado(matrix, fileName)
    ?? parseRecebimentosMatriz(matrix, fileName, anoPadrao)
    ?? { kind: 'recebimentos', rows: [], errors: ['Nenhum recebimento reconhecido na planilha'], totalRealizado: 0, totalPendente: 0 }
}

/**
 * Nome canônico do canal de recebimento.
 *
 * A base histórica escreve "Recebimento RedeMatriz" e a planilha mensal
 * "Cartão – Rede" para o mesmo canal. Sem normalizar, o mesmo canal vira duas
 * contas e a linha se parte no meio do ano. A grafia canônica é a da aba
 * "DRE Gerencial" do cliente.
 */
const CANAIS: [RegExp, string][] = [
  [/rede\s*matriz|cart(ã|a)o\s*[–\-]?\s*rede/i, 'Cartão – RedeMatriz'],
  [/brasil\s*card/i,                            'Cartão – BrasilCard'],
  [/funcional/i,                                'Cartão – Funcional'],
  [/^\s*(recebimento\s+)?pix\s*$/i,             'PIX'],
  [/dep(ó|o)sito/i,                             'Depósito'],
  [/transfer(ê|e)ncia/i,                        'Transferência Filial → Matriz'],
  [/i\s*food/i,                                 'iFood'],
  [/credi(á|a)rio/i,                            'Crediário'],
  [/outros\s+recebimentos/i,                    'Outros Recebimentos'],
]

export function canalCanonico(nome: string): string {
  const limpo = nome.replace(/\s+/g, ' ').trim()
  const achado = CANAIS.find(([re]) => re.test(limpo))
  return achado ? achado[1] : limpo
}

/** Último segmento do caminho do ERP — nome curto para exibir na DRE. */
export function nomeCurtoErp(erpKey: string): string {
  const partes = erpKey.split('>').map(s => s.trim()).filter(Boolean)
  const ultimo = partes[partes.length - 1] ?? erpKey
  return ultimo.replace(/^[\d.]+\s*-\s*/, '').trim() || ultimo
}

/** Código sugerido a partir da numeração do próprio ERP (ex.: "1.02.03"). */
export function codigoErp(erpKey: string): string | null {
  const partes = erpKey.split('>').map(s => s.trim()).filter(Boolean)
  for (let i = partes.length - 1; i >= 0; i--) {
    const m = partes[i].match(/^([\d]+(?:\.[\d]+)*)\s*-/)
    if (m) return m[1]
  }
  return null
}
