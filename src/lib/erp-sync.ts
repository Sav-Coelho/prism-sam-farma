/**
 * Resolução de cadastros na importação — o que faz o analista só precisar
 * subir os arquivos.
 *
 * - Chave do ERP (`Plano de Contas`) → conta do De-Para. Chave nova entra
 *   automaticamente como `⚠ A Classificar`, aparece no memo da DRE e na tela
 *   de Plano de Contas para o analista corrigir a categoria.
 * - Unidade do ERP (`Apelido Un. Neg.`) → `Unit`, criada se não existir.
 * - Canal de recebimento → conta de `Receita Operacional`.
 */
import { prisma } from './prisma'
import { CAT, typeForGroup } from './dre'
import { codigoErp, nomeCurtoErp, type RecebimentoRow } from './erp-import'

export interface ResolvidoAccount {
  id: number
  dreGroup: string
  novo: boolean
}

/** Próximo código livre dentro de um prefixo (ex.: "9.1.07"). */
async function proximoCodigo(prefixo: string): Promise<string> {
  const existentes = await prisma.account.findMany({
    where: { code: { startsWith: prefixo + '.' } },
    select: { code: true },
  })
  const nums = existentes.map(a => parseInt(a.code.split('.').pop() || '0') || 0)
  const proximo = (nums.length > 0 ? Math.max.apply(null, nums) : 0) + 1
  return prefixo + '.' + String(proximo).padStart(2, '0')
}

/**
 * Devolve um mapa erpKey → conta. Chaves desconhecidas são criadas como
 * `⚠ A Classificar` (nunca somam no resultado, aparecem no memo).
 */
export async function resolverContasErp(erpKeys: string[]): Promise<Record<string, ResolvidoAccount>> {
  const chaves = Array.from(new Set(erpKeys.filter(Boolean)))
  const mapa: Record<string, ResolvidoAccount> = {}
  if (chaves.length === 0) return mapa

  const existentes = await prisma.account.findMany({ where: { erpKey: { in: chaves } } })
  existentes.forEach(a => {
    if (a.erpKey) mapa[a.erpKey] = { id: a.id, dreGroup: a.dreGroup, novo: false }
  })

  const novas = chaves.filter(k => !mapa[k])
  for (const chave of novas) {
    const codigoNativo = codigoErp(chave)
    const code = codigoNativo && !(await prisma.account.findUnique({ where: { code: codigoNativo } }))
      ? codigoNativo
      : await proximoCodigo('9.1')
    try {
      const criada = await prisma.account.create({
        data: {
          code,
          name: nomeCurtoErp(chave),
          erpKey: chave,
          type: typeForGroup(CAT.A_CLASSIFICAR),
          dreGroup: CAT.A_CLASSIFICAR,
        },
      })
      mapa[chave] = { id: criada.id, dreGroup: criada.dreGroup, novo: true }
    } catch {
      // corrida com outra importação — busca de novo
      const achada = await prisma.account.findUnique({ where: { erpKey: chave } })
      if (achada) mapa[chave] = { id: achada.id, dreGroup: achada.dreGroup, novo: false }
    }
  }
  return mapa
}

/** Canal de recebimento → conta de Receita Operacional (criada se necessário). */
export async function resolverContasCanal(canais: string[]): Promise<Record<string, number>> {
  const nomes = Array.from(new Set(canais.filter(Boolean)))
  const mapa: Record<string, number> = {}
  if (nomes.length === 0) return mapa

  const existentes = await prisma.account.findMany({
    where: { dreGroup: CAT.RECEITA },
  })
  existentes.forEach(a => { mapa[a.name.toLowerCase()] = a.id })

  for (const canal of nomes) {
    if (mapa[canal.toLowerCase()]) continue
    const code = await proximoCodigo('1.1')
    try {
      const criada = await prisma.account.create({
        data: { code, name: canal, type: typeForGroup(CAT.RECEITA), dreGroup: CAT.RECEITA },
      })
      mapa[canal.toLowerCase()] = criada.id
    } catch {
      const achada = await prisma.account.findFirst({ where: { name: canal } })
      if (achada) mapa[canal.toLowerCase()] = achada.id
    }
  }
  return mapa
}

/** Nome de unidade a partir do apelido do ERP ("FARMA & FARMA - GOIANA" → "GOIANA"). */
export function nomeUnidade(apelido: string, codigo: string): string {
  // O ERP escreve "FARMA & FARMA - GOIANA" e também "FARMA & FARMA REPRESENTAÇÕES" (sem hífen)
  const limpo = apelido.replace(/^FARMA\s*&\s*FARMA\s*-?\s*/i, '').trim()
  return (limpo || apelido || codigo || 'SEM UNIDADE').toUpperCase()
}

/** Devolve um mapa "apelido|código" → unitId, criando as unidades que faltarem. */
export async function resolverUnidades(
  refs: { apelido: string; codigo: string }[]
): Promise<Record<string, number>> {
  const mapa: Record<string, number> = {}
  const unicos: Record<string, { apelido: string; codigo: string }> = {}
  refs.forEach(r => {
    const nome = nomeUnidade(r.apelido, r.codigo)
    if (!unicos[nome]) unicos[nome] = r
  })

  const existentes = await prisma.unit.findMany()
  const porNome: Record<string, number> = {}
  existentes.forEach(u => { porNome[u.name.toUpperCase()] = u.id })

  for (const nome of Object.keys(unicos)) {
    let id = porNome[nome]
    if (!id) {
      try {
        const criada = await prisma.unit.create({ data: { name: nome } })
        id = criada.id
      } catch {
        const achada = await prisma.unit.findFirst({ where: { name: nome } })
        if (achada) id = achada.id
      }
    }
    if (id) {
      mapa[nome] = id
      mapa[unicos[nome].apelido] = id
      mapa[unicos[nome].codigo] = id
    }
  }
  return mapa
}

/**
 * Grava recebimentos com SUBSTITUIÇÃO do mês: tudo que já estava gravado como
 * recebimento (`fitid` sf_rec_*) nos meses presentes no arquivo é apagado antes.
 * Reimportar o mesmo mês — com qualquer nome de arquivo — nunca soma.
 *
 * Linhas com `unidade` (arquivo mensal por loja) recebem a unidade do ERP;
 * sem ela, vale a unidade escolhida na tela (ou nenhuma = consolidado).
 */
export async function gravarRecebimentos(
  rows: RecebimentoRow[],
  unitIdManual: number | null
): Promise<{ apagados: number; gravados: number; meses: string[] }> {
  const contas = await resolverContasCanal(rows.map(r => r.canal))
  const comUnidade = rows.filter(r => r.unidade)
  const unidades = comUnidade.length > 0
    ? await resolverUnidades(comUnidade.map(r => ({ apelido: r.unidade!, codigo: r.unidade! })))
    : {}

  const chaves = Array.from(new Set(rows.map(r => r.year * 100 + r.month))).sort()
  let apagados = 0
  for (const ym of chaves) {
    const r = await prisma.transaction.deleteMany({
      where: { fitid: { startsWith: 'sf_rec_' }, year: Math.floor(ym / 100), month: ym % 100 },
    })
    apagados += r.count
  }

  const data = rows.map(r => {
    // Recebimento agregado do mês: data = último dia da competência
    const fim = new Date(r.year, r.month, 0)
    return {
      fitid: r.fitid,
      date: fim,
      dueDate: fim,
      description: r.canal,
      memo: r.canal + (r.unidade ? ' · ' + r.unidade : '') + ' · ' + (r.status === 'PENDENTE' ? 'a receber' : 'recebido'),
      amount: Math.abs(r.valor),
      month: r.month,
      year: r.year,
      status: r.status,
      accountId: contas[r.canal.toLowerCase()] ?? null,
      unitId: r.unidade ? (unidades[r.unidade] ?? null) : unitIdManual,
    }
  })
  const res = await prisma.transaction.createMany({ data, skipDuplicates: true })

  return {
    apagados,
    gravados: res.count,
    meses: chaves.map(ym => String(ym % 100).padStart(2, '0') + '/' + Math.floor(ym / 100)),
  }
}
