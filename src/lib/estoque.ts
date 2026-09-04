/**
 * Motor de margem e reposição por produto — transcrição fiel das fórmulas da
 * planilha "BRAVE · Painel — Sam Farma" (abas Igarassu/Goiana + Painel).
 *
 * Dois modos de demanda:
 *  - **período** (padrão): demanda/dia = itens vendidos ÷ (meses × 30,44);
 *    estoque mín/máx por dias de cobertura (lead + segurança [+ ciclo]).
 *  - **σ (diário)**: ativa quando o diário tem ≥ `minDiasDiario` dias corridos;
 *    demanda/dia e σ/dia vêm do diário e o mín/máx usa o nível de serviço z.
 *
 * O Painel considera só mercadoria (categorias fora de `categoriasExcluidas`).
 */

export interface ParamsEstoque {
  metaMargem: number          // 0.28
  pctCustosVar: number        // 0.235
  custoFixoMensal: number     // 130000 (agregado, rateado por faturamento)
  leadTimeDias: number        // 2
  cicloDias: number           // 20
  nivelServicoZ: number       // 1.65
  segurancaDias: number       // 7
  periodoMeses: number        // 6.44 — período coberto pelo relatório de vendas
  minDiasDiario: number       // 30
  benchmarkMargem: number     // 0.274
  categoriasExcluidas: string[]
}

export interface VendaEntrada {
  productId: number
  barcode: string
  name: string
  abc: string | null
  qty: number
  revenue: number
  custoVendas: number         // custo unit. do relatório de vendas (fallback)
}

export interface EstoqueEntrada {
  qty: number
  price: number
  cost: number
  abc: string | null
  category: string | null
}

export interface DiarioEntrada { qty: number; somaQty2: number }

export type Situacao = 'Repor' | 'OK' | 'Excesso' | 'Sem giro' | 'Sem cadastro'

export interface ProdutoCalc {
  productId: number
  barcode: string
  name: string
  category: string
  abc: string
  qtdVendida: number
  faturamento: number
  precoMedio: number | null
  custoMedio: number
  lucro: number               // faturamento − qtd × custo (aux AA da planilha)
  margemPct: number | null
  mcPct: number | null
  precoSugerido: number | null
  custoAlvo: number | null
  giroMes: number
  sigmaDia: number | null     // só no modo σ
  estoqueAtual: number | null // null = produto sem cadastro no relatório de estoque
  estoqueMin: number
  estoqueMax: number
  sugestaoCompra: number | null
  valorCompra: number         // sugestão × custo médio
  situacao: Situacao
  elegivel: boolean           // false = categoria de não-mercadoria (fora do Painel)
  precoTabela: number | null
}

const MES_DIAS = 30.44

/** ROUNDUP com tolerância a ruído de ponto flutuante. */
const roundUp = (v: number) => Math.ceil(v - 1e-9)

export function calcularProdutos(
  vendas: VendaEntrada[],
  estoquePorProduto: Record<number, EstoqueEntrada>,
  diarioPorProduto: Record<number, DiarioEntrada>,
  diasDiario: number,
  p: ParamsEstoque
): ProdutoCalc[] {
  const modoSigma = diasDiario >= p.minDiasDiario
  const periodoDias = p.periodoMeses * MES_DIAS
  const excluidas: Record<string, boolean> = {}
  p.categoriasExcluidas.forEach(c => { excluidas[c.trim().toUpperCase()] = true })

  return vendas.map(v => {
    const est = estoquePorProduto[v.productId]
    const precoMedio = v.qty !== 0 ? v.revenue / v.qty : null
    const custoMedio = est && est.cost > 0 ? est.cost : (v.custoVendas || 0)
    const lucro = v.revenue - v.qty * custoMedio
    const margemPct = v.revenue !== 0 ? lucro / v.revenue : null
    const mcPct = margemPct !== null ? margemPct - p.pctCustosVar : null
    const precoSugerido = 1 - p.metaMargem > 0 ? custoMedio / (1 - p.metaMargem) : null
    const custoAlvo = precoMedio !== null ? precoMedio * (1 - p.metaMargem) : null

    const diario = diarioPorProduto[v.productId]
    const demandaDia = modoSigma
      ? (diario ? diario.qty : 0) / diasDiario
      : (periodoDias > 0 ? v.qty / periodoDias : 0)
    const sigma = modoSigma && diario && diario.qty > 0
      ? Math.sqrt(Math.max(0, diario.somaQty2 / diasDiario - Math.pow(diario.qty / diasDiario, 2)))
      : 0
    const giroMes = demandaDia * MES_DIAS

    const estoqueMin = modoSigma
      ? roundUp(demandaDia * p.leadTimeDias + p.nivelServicoZ * sigma * Math.sqrt(p.leadTimeDias))
      : roundUp(demandaDia * (p.leadTimeDias + p.segurancaDias))
    const estoqueMax = modoSigma
      ? roundUp(demandaDia * (p.leadTimeDias + p.cicloDias) + p.nivelServicoZ * sigma * Math.sqrt(p.leadTimeDias + p.cicloDias))
      : roundUp(demandaDia * (p.leadTimeDias + p.segurancaDias + p.cicloDias))

    const estoqueAtual = est ? est.qty : null
    const sugestaoCompra = estoqueAtual === null ? null : Math.max(0, estoqueMax - estoqueAtual)

    let situacao: Situacao
    if (demandaDia === 0) situacao = 'Sem giro'
    else if (estoqueAtual === null) situacao = 'Sem cadastro'
    else if (estoqueAtual < estoqueMin) situacao = 'Repor'
    else if (estoqueAtual > estoqueMax) situacao = 'Excesso'
    else situacao = 'OK'

    const category = est ? (est.category || 'Não Classificado') : 'Sem cadastro'

    return {
      productId: v.productId,
      barcode: v.barcode,
      name: v.name,
      category,
      abc: (v.abc || (est ? est.abc : '') || '').trim(),
      qtdVendida: v.qty,
      faturamento: v.revenue,
      precoMedio,
      custoMedio,
      lucro,
      margemPct,
      mcPct,
      precoSugerido,
      custoAlvo,
      giroMes,
      sigmaDia: modoSigma ? sigma : null,
      estoqueAtual,
      estoqueMin,
      estoqueMax,
      sugestaoCompra,
      valorCompra: (sugestaoCompra || 0) * custoMedio,
      situacao,
      elegivel: !excluidas[category.toUpperCase()],
      precoTabela: est ? est.price : null,
    }
  })
}

export interface PainelLoja {
  unitId: number
  nome: string
  faturamentoTotal: number
  faturamentoMedioMensal: number
  margemBruta: number | null
  margemContribuicao: number | null
  custoFixoRateado: number
  pontoEquilibrio: number | null   // null = MC ≤ 0 ("n/d")
  vsBenchmark: number | null
}

export interface PainelAgregado {
  faturamentoCombinado: number
  faturamentoMedioMensal: number
}

/** Painel por loja + agregado. Entrada: Σ faturamento e Σ lucro dos itens ELEGÍVEIS. */
export function calcularPainel(
  lojas: { unitId: number; nome: string; faturamento: number; lucro: number }[],
  p: ParamsEstoque
): { lojas: PainelLoja[]; agregado: PainelAgregado } {
  const fatTotal = lojas.reduce((s, l) => s + l.faturamento, 0)

  const painel = lojas.map(l => {
    const margem = l.faturamento > 0 ? l.lucro / l.faturamento : null
    const mc = margem !== null ? margem - p.pctCustosVar : null
    const custoFixoRateado = p.custoFixoMensal * (fatTotal > 0 ? l.faturamento / fatTotal : 0)
    return {
      unitId: l.unitId,
      nome: l.nome,
      faturamentoTotal: l.faturamento,
      faturamentoMedioMensal: p.periodoMeses > 0 ? l.faturamento / p.periodoMeses : 0,
      margemBruta: margem,
      margemContribuicao: mc,
      custoFixoRateado,
      pontoEquilibrio: mc !== null && mc > 0 ? custoFixoRateado / mc : null,
      vsBenchmark: margem !== null ? margem - p.benchmarkMargem : null,
    }
  })

  return {
    lojas: painel,
    agregado: {
      faturamentoCombinado: fatTotal,
      faturamentoMedioMensal: p.periodoMeses > 0 ? fatTotal / p.periodoMeses : 0,
    },
  }
}

/** Converte a linha StockSettings do banco nos parâmetros do motor. */
export function paramsDeSettings(s: {
  metaMargem: number; pctCustosVar: number; custoFixoMensal: number; leadTimeDias: number
  cicloDias: number; nivelServicoZ: number; segurancaDias: number; periodoMeses: number
  minDiasDiario: number; benchmarkMargem: number; categoriasExcluidas: string
}): ParamsEstoque {
  return {
    metaMargem: s.metaMargem,
    pctCustosVar: s.pctCustosVar,
    custoFixoMensal: s.custoFixoMensal,
    leadTimeDias: s.leadTimeDias,
    cicloDias: s.cicloDias,
    nivelServicoZ: s.nivelServicoZ,
    segurancaDias: s.segurancaDias,
    periodoMeses: s.periodoMeses,
    minDiasDiario: s.minDiasDiario,
    benchmarkMargem: s.benchmarkMargem,
    categoriasExcluidas: s.categoriasExcluidas.split('|').map(c => c.trim()).filter(Boolean),
  }
}
