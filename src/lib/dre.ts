export type DRELineType = 'section' | 'group' | 'account' | 'subtotal' | 'breakeven' | 'transfer'

export interface DRELine {
  type: DRELineType
  label: string
  sublabel?: string
  value: number
  indent: number
  highlight: boolean
}

export interface DREData {
  month: number
  year: number
  lines: DRELine[]
  receitaBruta: number
  receitaLiquida: number
  margemContribuicao: number
  resultadoBruto: number        // alias margemContribuicao
  resultadoOperacional: number  // lucroOperacional
  lucroAposInvestimentos: number
  lucroAntesImpostos: number
  resultadoLiquido: number
  // Pontos de equilíbrio (receita mínima) e % da margem de contribuição
  peo: number                   // Ponto de Equilíbrio Operacional
  pei: number                   // Ponto de Equilíbrio de Investimentos
  pef: number                   // Ponto de Equilíbrio Financeiro
  mcPct: number                 // margem de contribuição / receita operacional
  custosFixos: number
  investimentos: number
  /** Total classificado em `dreGroup` fora da estrutura — não entra em nenhum subtotal */
  naoMapeado: number
}

/** Grupos válidos de `Account.dreGroup` — exatos, case-sensitive. */
export const DRE_GROUPS: Record<string, string[]> = {
  RECEITA: ['Receita Operacional', 'Receita Não Operacional'],
  DEDUCAO: ['Deduções sobre a Venda'],
  CUSTO: ['Custo do Produto/Serviço', 'Despesa Variável'],
  DESPESA: [
    'Despesas Administrativas',
    'Despesas Financeiras',
    'Despesas com Pessoal',
    'Despesas com Marketing',
    'Despesas Comerciais',
    'Investimentos',
    'Despesas Não Operacionais',
  ],
  IMPOSTO: ['Impostos'],
  NEUTRO: ['Transferência entre Contas'],
}

export const ACCOUNT_TYPES = ['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'IMPOSTO', 'NEUTRO']

/** Conta especial semeada no boot — nunca entra nos totais da DRE. */
export const TRANSFER_GROUP = 'Transferência entre Contas'

/** Todos os `dreGroup` que a DRE sabe posicionar. */
export const ALL_DRE_GROUPS: string[] = Object.keys(DRE_GROUPS)
  .reduce<string[]>((acc, t) => acc.concat(DRE_GROUPS[t]), [])

export const isValidDreGroup = (group: string): boolean =>
  ALL_DRE_GROUPS.indexOf(group) >= 0

interface AccEntry { name: string; code: string; value: number }

export function calcDRE(
  transactions: Array<{ amount: number; account: { type: string; dreGroup: string; name: string; code: string } | null }>,
  month: number,
  year: number
): DREData {
  // Agrega por dreGroup e por conta individual
  const byGroup: Record<string, number> = {}
  const byAccount: Record<string, AccEntry[]> = {}
  let transferSaida = 0
  let transferEntrada = 0

  for (const tx of transactions) {
    if (!tx.account) continue
    const { dreGroup, name, code } = tx.account
    if (dreGroup === TRANSFER_GROUP) {
      if (tx.amount < 0) transferSaida += Math.abs(tx.amount)
      else transferEntrada += tx.amount
      continue
    }
    const val = Math.abs(tx.amount)
    byGroup[dreGroup] = (byGroup[dreGroup] || 0) + val
    if (!byAccount[dreGroup]) byAccount[dreGroup] = []
    const ex = byAccount[dreGroup].find(a => a.name === name)
    if (ex) { ex.value += val } else { byAccount[dreGroup].push({ name, code, value: val }) }
  }

  const g = (group: string) => byGroup[group] || 0

  const accts = (group: string, positive: boolean, indent: number): DRELine[] =>
    (byAccount[group] || [])
      .filter(a => a.value > 0)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(a => ({
        type: 'account' as const,
        label: a.name,
        value: positive ? a.value : -a.value,
        indent,
        highlight: false,
      }))

  // Totais intermediários
  const receitaOp    = g('Receita Operacional')
  const deducoes     = g('Deduções sobre a Venda')
  const receitaLiq   = receitaOp - deducoes

  const custoProd    = g('Custo do Produto/Serviço')
  const despVar      = g('Despesa Variável')
  const custosVar    = custoProd + despVar
  const margem       = receitaLiq - custosVar

  const despAdmin    = g('Despesas Administrativas')
  const despFin      = g('Despesas Financeiras')
  const despPessoal  = g('Despesas com Pessoal')
  const despMkt      = g('Despesas com Marketing')
  const despCom      = g('Despesas Comerciais')
  const custosFixos  = despAdmin + despFin + despPessoal + despMkt + despCom
  const lucroOp      = margem - custosFixos

  const invest       = g('Investimentos')
  const lucroAposInv = lucroOp - invest

  const recNaoOp     = g('Receita Não Operacional')
  const despNaoOp    = g('Despesas Não Operacionais')
  const lucroAntesIR = lucroAposInv + recNaoOp - despNaoOp

  const impostos     = g('Impostos')
  const lucroLiq     = lucroAntesIR - impostos

  // Contas cujo dreGroup não existe na estrutura (typo na importação, acento diferente).
  // Não somam em nada — mas precisam aparecer, senão o valor desaparece sem aviso.
  const naoMapeados = Object.keys(byGroup).filter(k => !isValidDreGroup(k))
  const naoMapeado = naoMapeados.reduce((s, k) => s + byGroup[k], 0)

  // Pontos de equilíbrio (contábil)
  const mcPct = receitaOp > 0 ? margem / receitaOp : 0
  const peo   = mcPct > 0 ? custosFixos / mcPct : 0
  const pei   = mcPct > 0 ? (custosFixos + invest) / mcPct : 0
  const pef   = mcPct > 0 ? (custosFixos + invest + Math.max(0, despNaoOp - recNaoOp)) / mcPct : 0

  const lines: DRELine[] = [
    // ── RECEITAS ──────────────────────────────────────────
    { type: 'group', label: 'Receita Operacional', value: receitaOp, indent: 0, highlight: false },
    ...accts('Receita Operacional', true, 1),

    { type: 'group', label: 'Deduções sobre a Venda', sublabel: '(-) impostos, taxas e tarifas', value: -deducoes, indent: 0, highlight: false },
    ...accts('Deduções sobre a Venda', false, 1),

    { type: 'subtotal', label: '(=) Receita Líquida de Vendas', value: receitaLiq, indent: 0, highlight: true },

    // ── CUSTOS VARIÁVEIS ──────────────────────────────────
    { type: 'section', label: '(-) Custos Variáveis', value: -custosVar, indent: 0, highlight: false },

    { type: 'group', label: 'Custo do Produto/Serviço', value: -custoProd, indent: 1, highlight: false },
    ...accts('Custo do Produto/Serviço', false, 2),

    { type: 'group', label: 'Despesa Variável', value: -despVar, indent: 1, highlight: false },
    ...accts('Despesa Variável', false, 2),

    { type: 'subtotal', label: '(=) Margem de Contribuição', value: margem, indent: 0, highlight: true },
    ...(peo > 0 ? [{ type: 'breakeven' as const, label: '(=) Ponto de Equilíbrio Operacional', sublabel: 'receita mínima para cobrir custos fixos', value: peo, indent: 0, highlight: false }] : []),

    // ── CUSTOS FIXOS ──────────────────────────────────────
    { type: 'section', label: '(-) Custos Fixos', value: -custosFixos, indent: 0, highlight: false },

    { type: 'group', label: 'Despesas Administrativas', value: -despAdmin, indent: 1, highlight: false },
    ...accts('Despesas Administrativas', false, 2),

    { type: 'group', label: 'Despesas Financeiras', value: -despFin, indent: 1, highlight: false },
    ...accts('Despesas Financeiras', false, 2),

    { type: 'group', label: 'Despesas com Pessoal', value: -despPessoal, indent: 1, highlight: false },
    ...accts('Despesas com Pessoal', false, 2),

    { type: 'group', label: 'Despesas com Marketing', value: -despMkt, indent: 1, highlight: false },
    ...accts('Despesas com Marketing', false, 2),

    { type: 'group', label: 'Despesas Comerciais', value: -despCom, indent: 1, highlight: false },
    ...accts('Despesas Comerciais', false, 2),

    { type: 'subtotal', label: '(=) Lucro Operacional', sublabel: 'EBIT', value: lucroOp, indent: 0, highlight: true },
    ...(pei > 0 ? [{ type: 'breakeven' as const, label: '(=) Ponto de Equilíbrio de Investimentos', value: pei, indent: 0, highlight: false }] : []),

    // ── INVESTIMENTOS ─────────────────────────────────────
    { type: 'section', label: '(-) Investimentos', value: -invest, indent: 0, highlight: false },
    { type: 'group', label: 'Investimento em Desenv. Empresarial', value: -invest, indent: 1, highlight: false },
    ...accts('Investimentos', false, 2),

    { type: 'subtotal', label: '(=) Lucro após os Investimentos', value: lucroAposInv, indent: 0, highlight: true },
    ...(pef > 0 ? [{ type: 'breakeven' as const, label: '(=) Ponto de Equilíbrio Financeiro', value: pef, indent: 0, highlight: false }] : []),

    // ── NÃO OPERACIONAIS ──────────────────────────────────
    { type: 'section', label: '(+/-) Outras Receitas e Despesas Não Operacionais', value: recNaoOp - despNaoOp, indent: 0, highlight: false },

    { type: 'group', label: 'Receita Não Operacional', value: recNaoOp, indent: 1, highlight: false },
    ...accts('Receita Não Operacional', true, 2),

    { type: 'group', label: 'Despesas Não Operacionais', value: -despNaoOp, indent: 1, highlight: false },
    ...accts('Despesas Não Operacionais', false, 2),

    { type: 'subtotal', label: '(=) Lucro antes dos Impostos', value: lucroAntesIR, indent: 0, highlight: true },

    // ── IMPOSTOS ──────────────────────────────────────────
    { type: 'group', label: 'Impostos', value: -impostos, indent: 0, highlight: false },
    ...accts('Impostos', false, 1),

    { type: 'subtotal', label: '(=) Lucro Líquido', value: lucroLiq, indent: 0, highlight: true },

    // Alerta — grupo desconhecido, valor fora de todos os subtotais acima
    ...(naoMapeado > 0 ? [
      { type: 'transfer' as const, label: '⚠ Contas fora da estrutura da DRE', sublabel: `grupo não reconhecido: ${naoMapeados.join(' · ')} — corrija o Grupo DRE no plano de contas`, value: 0, indent: 0, highlight: false },
      ...naoMapeados.map(k => ({
        type: 'transfer' as const,
        label: k,
        value: byGroup[k],
        indent: 1,
        highlight: false,
      })),
    ] : []),

    // Informativo — transferências não afetam nenhum total
    ...(transferSaida > 0 || transferEntrada > 0 ? [
      { type: 'transfer' as const, label: 'Transferências entre Contas', sublabel: 'informativo — não contabiliza no resultado', value: 0, indent: 0, highlight: false },
      ...(transferSaida > 0 ? [{ type: 'transfer' as const, label: 'Saídas de Transferência', value: -transferSaida, indent: 1, highlight: false }] : []),
      ...(transferEntrada > 0 ? [{ type: 'transfer' as const, label: 'Entradas de Transferência', value: transferEntrada, indent: 1, highlight: false }] : []),
    ] : []),
  ]

  return {
    month, year, lines,
    receitaBruta: receitaOp,
    receitaLiquida: receitaLiq,
    margemContribuicao: margem,
    resultadoBruto: margem,
    resultadoOperacional: lucroOp,
    lucroAposInvestimentos: lucroAposInv,
    lucroAntesImpostos: lucroAntesIR,
    resultadoLiquido: lucroLiq,
    peo, pei, pef, mcPct,
    custosFixos,
    investimentos: invest,
    naoMapeado,
  }
}

export const MONTH_NAMES = [
  '', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
]
