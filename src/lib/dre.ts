/**
 * DRE Gerencial — Sam Farma (regime de caixa).
 *
 * Estrutura replicada da planilha "DRE Gerencial" do cliente: receita por canal
 * de recebimento, CMV, margem de contribuição, despesas operacionais, lucro
 * operacional, impostos, EBITDA, financeiras, pró-labore e despesas de sócio,
 * chegando ao lucro líquido gerencial.
 */

export type DRELineType = 'section' | 'group' | 'account' | 'subtotal' | 'memo'

export interface DRELine {
  type: DRELineType
  label: string
  sublabel?: string
  value: number
  indent: number
  highlight: boolean
}

/** Categorias da DRE — string exata, igual à coluna "Categoria DRE" do De-Para. */
export const CAT = {
  RECEITA:       'Receita Operacional',
  DEDUCAO:       'Deduções sobre Venda',
  CMV:           'Custos Variáveis Operacionais',
  ADMIN:         'Despesas Administrativas',
  PESSOAL:       'Despesas com Pessoal',
  LOGISTICA:     'Despesas Logísticas',
  COMERCIAL:     'Despesas Comerciais',
  IMPOSTOS:      'Impostos',
  FINANCEIRAS:   'Despesas Financeiras',
  PROLABORE:     'Pró-Labore',
  SOCIO:         'Despesas de Sócio',
  INVESTIMENTO:  'Investimento (memo - fora do resultado)',
  A_CLASSIFICAR: '⚠ A Classificar',
  TRANSFERENCIA: 'Transferência entre Contas',
}

/** Categorias agrupadas por tipo — usado nos selects e nos badges. */
export const DRE_GROUPS: Record<string, string[]> = {
  RECEITA:  [CAT.RECEITA],
  DEDUCAO:  [CAT.DEDUCAO],
  CUSTO:    [CAT.CMV],
  DESPESA:  [CAT.ADMIN, CAT.PESSOAL, CAT.LOGISTICA, CAT.COMERCIAL, CAT.FINANCEIRAS, CAT.PROLABORE, CAT.SOCIO],
  IMPOSTO:  [CAT.IMPOSTOS],
  NEUTRO:   [CAT.INVESTIMENTO, CAT.A_CLASSIFICAR, CAT.TRANSFERENCIA],
}

export const ACCOUNT_TYPES = ['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'IMPOSTO', 'NEUTRO']

export const ALL_DRE_GROUPS: string[] = Object.keys(DRE_GROUPS)
  .reduce<string[]>((acc, t) => acc.concat(DRE_GROUPS[t]), [])

export const isValidDreGroup = (group: string): boolean =>
  ALL_DRE_GROUPS.indexOf(group) >= 0

/** Tipo correspondente a uma categoria (uma categoria pertence a um único tipo). */
export const typeForGroup = (group: string): string =>
  ACCOUNT_TYPES.find(t => DRE_GROUPS[t].indexOf(group) >= 0) || 'DESPESA'

/** Categorias que ficam fora do resultado (memo). */
export const MEMO_GROUPS: string[] = [CAT.INVESTIMENTO, CAT.A_CLASSIFICAR, CAT.TRANSFERENCIA]

export const TRANSFER_GROUP: string = CAT.TRANSFERENCIA

export interface DREData {
  month: number
  year: number
  lines: DRELine[]
  receitaBruta: number
  receitaLiquida: number
  margemContribuicao: number
  cmv: number
  despesasOperacionais: number   // admin + pessoal + logística + comercial
  lucroOperacional: number
  impostos: number
  ebitda: number
  financeiras: number
  proLabore: number
  despesasSocio: number
  lucroLiquido: number
  // Memo — não integram o resultado
  investimentos: number
  aClassificar: number
  transferencias: number
  naoMapeado: number
  // Ponto de equilíbrio — análise adicional, fora do modelo do cliente
  mcPct: number
  peo: number
  pei: number
  pef: number
  custosFixos: number
  // Nomes mantidos por compatibilidade com as telas
  resultadoOperacional: number
  resultadoLiquido: number
}

interface AccEntry { name: string; code: string; value: number }

export function calcDRE(
  transactions: Array<{ amount: number; account: { type: string; dreGroup: string; name: string; code: string } | null }>,
  month: number,
  year: number
): DREData {
  const byGroup: Record<string, number> = {}
  const byAccount: Record<string, AccEntry[]> = {}

  for (const tx of transactions) {
    if (!tx.account) continue
    const { dreGroup, name, code } = tx.account
    const val = Math.abs(tx.amount)
    byGroup[dreGroup] = (byGroup[dreGroup] || 0) + val
    if (!byAccount[dreGroup]) byAccount[dreGroup] = []
    const ex = byAccount[dreGroup].find(a => a.name === name)
    if (ex) { ex.value += val } else { byAccount[dreGroup].push({ name, code, value: val }) }
  }

  const g = (group: string) => byGroup[group] || 0

  /** Linhas de detalhe de uma categoria, da maior para a menor. */
  const detalhe = (group: string, positive: boolean, indent: number): DRELine[] =>
    (byAccount[group] || [])
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(a => ({
        type: 'account' as const,
        label: a.name,
        value: positive ? a.value : -a.value,
        indent,
        highlight: false,
      }))

  const receitaBruta = g(CAT.RECEITA)
  const deducoes     = g(CAT.DEDUCAO)
  const receitaLiq   = receitaBruta - deducoes

  const cmv          = g(CAT.CMV)
  const margem       = receitaLiq - cmv

  const admin        = g(CAT.ADMIN)
  const pessoal      = g(CAT.PESSOAL)
  const logistica    = g(CAT.LOGISTICA)
  const comercial    = g(CAT.COMERCIAL)
  const despOp       = admin + pessoal + logistica + comercial
  const lucroOp      = margem - despOp

  const impostos     = g(CAT.IMPOSTOS)
  const ebitda       = lucroOp - impostos

  const financeiras  = g(CAT.FINANCEIRAS)
  const proLabore    = g(CAT.PROLABORE)
  const socio        = g(CAT.SOCIO)
  const lucroLiquido = ebitda - financeiras - proLabore - socio

  const investimentos  = g(CAT.INVESTIMENTO)
  const aClassificar   = g(CAT.A_CLASSIFICAR)
  const transferencias = g(CAT.TRANSFERENCIA)

  // Contas com categoria fora da estrutura — nunca somam, mas precisam aparecer
  const naoMapeados = Object.keys(byGroup).filter(k => !isValidDreGroup(k))
  const naoMapeado = naoMapeados.reduce((s, k) => s + byGroup[k], 0)

  // Ponto de equilíbrio (análise adicional, fora do modelo do cliente)
  const mcPct = receitaBruta > 0 ? margem / receitaBruta : 0
  const peo = mcPct > 0 ? despOp / mcPct : 0
  const pei = mcPct > 0 ? (despOp + impostos + financeiras) / mcPct : 0
  const pef = mcPct > 0 ? (despOp + impostos + financeiras + proLabore + socio + investimentos) / mcPct : 0

  const memoLines: DRELine[] = []
  if (investimentos > 0 || aClassificar > 0 || transferencias > 0 || naoMapeado > 0) {
    memoLines.push({ type: 'memo', label: 'MEMO — não integra o resultado gerencial', value: 0, indent: 0, highlight: false })
    if (investimentos > 0) {
      memoLines.push({ type: 'memo', label: 'Investimentos / Imobilizado (CAPEX)', value: -investimentos, indent: 1, highlight: false })
    }
    if (aClassificar > 0) {
      memoLines.push({ type: 'memo', label: '⚠ A Classificar', sublabel: 'revisar o De-Para no Plano de Contas', value: -aClassificar, indent: 1, highlight: false })
    }
    if (transferencias > 0) {
      memoLines.push({ type: 'memo', label: 'Transferências entre Contas', value: -transferencias, indent: 1, highlight: false })
    }
    if (naoMapeado > 0) {
      memoLines.push({
        type: 'memo',
        label: '⚠ Contas fora da estrutura da DRE',
        sublabel: 'categoria não reconhecida: ' + naoMapeados.join(' · '),
        value: -naoMapeado,
        indent: 1,
        highlight: false,
      })
    }
  }

  const lines: DRELine[] = [
    { type: 'section', label: '(+) FONTES DE RECEITA OPERACIONAL BRUTA', value: receitaBruta, indent: 0, highlight: false },
    ...detalhe(CAT.RECEITA, true, 1),

    { type: 'subtotal', label: '(=) RECEITA OPERACIONAL BRUTA', value: receitaBruta, indent: 0, highlight: true },

    { type: 'group', label: '(-) Deduções sobre Venda', sublabel: 'exceto impostos', value: -deducoes, indent: 0, highlight: false },
    ...detalhe(CAT.DEDUCAO, false, 1),

    { type: 'subtotal', label: '(=) RECEITA LÍQUIDA', value: receitaLiq, indent: 0, highlight: true },

    { type: 'group', label: '(-) Custos Variáveis Operacionais', sublabel: 'CMV', value: -cmv, indent: 0, highlight: false },
    ...detalhe(CAT.CMV, false, 1),

    { type: 'subtotal', label: '(=) MARGEM DE CONTRIBUIÇÃO / LUCRO BRUTO', value: margem, indent: 0, highlight: true },

    { type: 'group', label: '(-) Despesas Administrativas', value: -admin, indent: 0, highlight: false },
    ...detalhe(CAT.ADMIN, false, 1),

    { type: 'group', label: '(-) Despesas com Pessoal', value: -pessoal, indent: 0, highlight: false },
    ...detalhe(CAT.PESSOAL, false, 1),

    { type: 'group', label: '(-) Despesas Logísticas', value: -logistica, indent: 0, highlight: false },
    ...detalhe(CAT.LOGISTICA, false, 1),

    { type: 'group', label: '(-) Despesas Comerciais', value: -comercial, indent: 0, highlight: false },
    ...detalhe(CAT.COMERCIAL, false, 1),

    { type: 'subtotal', label: '(=) LUCRO OPERACIONAL', value: lucroOp, indent: 0, highlight: true },

    { type: 'group', label: '(-) Impostos', value: -impostos, indent: 0, highlight: false },
    ...detalhe(CAT.IMPOSTOS, false, 1),

    { type: 'subtotal', label: '(=) EBITDA', value: ebitda, indent: 0, highlight: true },

    { type: 'group', label: '(-) Despesas Financeiras', value: -financeiras, indent: 0, highlight: false },
    ...detalhe(CAT.FINANCEIRAS, false, 1),

    { type: 'group', label: '(-) Pró-Labore', value: -proLabore, indent: 0, highlight: false },
    ...detalhe(CAT.PROLABORE, false, 1),

    { type: 'group', label: '(-) Despesas de Sócio', value: -socio, indent: 0, highlight: false },
    ...detalhe(CAT.SOCIO, false, 1),

    { type: 'subtotal', label: '(=) LUCRO LÍQUIDO GERENCIAL', value: lucroLiquido, indent: 0, highlight: true },

    ...memoLines,
  ]

  return {
    month, year, lines,
    receitaBruta,
    receitaLiquida: receitaLiq,
    margemContribuicao: margem,
    cmv,
    despesasOperacionais: despOp,
    lucroOperacional: lucroOp,
    impostos,
    ebitda,
    financeiras,
    proLabore,
    despesasSocio: socio,
    lucroLiquido,
    investimentos,
    aClassificar,
    transferencias,
    naoMapeado,
    mcPct, peo, pei, pef,
    custosFixos: despOp,
    resultadoOperacional: lucroOp,
    resultadoLiquido: lucroLiquido,
  }
}

export const MONTH_NAMES = [
  '', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
]
