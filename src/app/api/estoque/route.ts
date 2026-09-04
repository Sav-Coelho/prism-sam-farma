import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  calcularProdutos, calcularPainel, paramsDeSettings,
  type DiarioEntrada, type EstoqueEntrada, type ProdutoCalc, type VendaEntrada,
} from '@/lib/estoque'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_PRODUTOS = 500

async function obterSettings() {
  return prisma.stockSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
}

/** Vendas + estoque + diário de uma unidade → produtos calculados. */
async function calcularUnidade(unitId: number, params: ReturnType<typeof paramsDeSettings>) {
  const [vendas, estoque, agregadoDiario] = await Promise.all([
    prisma.salesItem.findMany({
      where: { unitId },
      include: { product: { select: { barcode: true, name: true } } },
    }),
    prisma.stockPosition.findMany({
      where: { unitId },
      select: { productId: true, qty: true, price: true, cost: true, abc: true, category: true },
    }),
    prisma.dailySale.aggregate({ where: { unitId }, _min: { date: true }, _max: { date: true } }),
  ])

  const diasDiario = agregadoDiario._min.date && agregadoDiario._max.date
    ? Math.round((agregadoDiario._max.date.getTime() - agregadoDiario._min.date.getTime()) / 86400000) + 1
    : 0

  const estoquePorProduto: Record<number, EstoqueEntrada> = {}
  estoque.forEach(e => { estoquePorProduto[e.productId] = e })

  const diarioPorProduto: Record<number, DiarioEntrada> = {}
  if (diasDiario >= params.minDiasDiario) {
    const somas = await prisma.$queryRaw<{ productId: number; q: number; q2: number }[]>`
      SELECT "productId", SUM("qty")::float AS q, SUM("qty" * "qty")::float AS q2
      FROM "DailySale" WHERE "unitId" = ${unitId} GROUP BY "productId"`
    somas.forEach(s => { diarioPorProduto[s.productId] = { qty: Number(s.q), somaQty2: Number(s.q2) } })
  }

  const entradas: VendaEntrada[] = vendas.map(v => ({
    productId: v.productId,
    barcode: v.product.barcode,
    name: v.product.name,
    abc: v.abc,
    qty: v.qty,
    revenue: v.revenue,
    custoVendas: v.cost,
  }))

  return {
    produtos: calcularProdutos(entradas, estoquePorProduto, diarioPorProduto, diasDiario, params),
    diasDiario,
    skusEstoque: estoque.length,
  }
}

/**
 * GET /api/estoque?unitId=&situacao=&abc=&q=&sort=&soMercadoria=1
 *
 * Devolve o painel (todas as lojas + agregado, réplica do "Painel" da planilha)
 * e a tabela de produtos da unidade selecionada (filtrada, até 500 linhas).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const settings = await obterSettings()
  const params = paramsDeSettings(settings)

  // Unidades que têm dados de vendas ou estoque
  const [comVendas, comEstoque, units] = await Promise.all([
    prisma.salesItem.groupBy({ by: ['unitId'], _count: true }),
    prisma.stockPosition.groupBy({ by: ['unitId'], _count: true }),
    prisma.unit.findMany({ orderBy: { name: 'asc' } }),
  ])
  const idsComDados: number[] = []
  comVendas.forEach(g => { if (idsComDados.indexOf(g.unitId) < 0) idsComDados.push(g.unitId) })
  comEstoque.forEach(g => { if (idsComDados.indexOf(g.unitId) < 0) idsComDados.push(g.unitId) })
  const unidades = units.map(u => ({ id: u.id, name: u.name, temDados: idsComDados.indexOf(u.id) >= 0 }))

  const pedido = parseInt(searchParams.get('unitId') || '0')
  const unitId = pedido || (unidades.find(u => u.temDados)?.id ?? 0)

  if (idsComDados.length === 0) {
    return NextResponse.json({
      settings, unidades, unitId: null, painel: null, produtos: [],
      contagens: {}, totalProdutos: 0, diasDiario: 0, modoSigma: false, atualizadoEm: {},
    })
  }

  // Calcula todas as lojas com dados (o rateio do custo fixo precisa das duas)
  const porLoja: { unitId: number; nome: string; produtos: ProdutoCalc[]; diasDiario: number }[] = []
  for (const id of idsComDados) {
    const r = await calcularUnidade(id, params)
    porLoja.push({
      unitId: id,
      nome: units.find(u => u.id === id)?.name ?? String(id),
      produtos: r.produtos,
      diasDiario: r.diasDiario,
    })
  }

  const painel = calcularPainel(
    porLoja.map(l => ({
      unitId: l.unitId,
      nome: l.nome,
      faturamento: l.produtos.reduce((s, p) => s + (p.elegivel ? p.faturamento : 0), 0),
      lucro: l.produtos.reduce((s, p) => s + (p.elegivel ? p.lucro : 0), 0),
    })),
    params
  )

  const daLoja = porLoja.find(l => l.unitId === unitId) ?? porLoja[0]

  // Contagens por situação (antes dos filtros — alimenta os chips da tela)
  const contagens: Record<string, number> = {}
  daLoja.produtos.forEach(p => { contagens[p.situacao] = (contagens[p.situacao] || 0) + 1 })

  // Filtros
  const situacao = searchParams.get('situacao') || ''
  const abc = searchParams.get('abc') || ''
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  const soMercadoria = searchParams.get('soMercadoria') === '1'
  const sort = searchParams.get('sort') || 'compra'

  let lista = daLoja.produtos
  if (situacao) lista = lista.filter(p => p.situacao === situacao)
  if (abc) lista = lista.filter(p => p.abc === abc)
  if (soMercadoria) lista = lista.filter(p => p.elegivel)
  if (q) lista = lista.filter(p => p.name.toLowerCase().indexOf(q) >= 0 || p.barcode.indexOf(q) >= 0)

  const ordenadores: Record<string, (a: ProdutoCalc, b: ProdutoCalc) => number> = {
    compra: (a, b) => b.valorCompra - a.valorCompra || b.faturamento - a.faturamento,
    faturamento: (a, b) => b.faturamento - a.faturamento,
    margem: (a, b) => (a.margemPct ?? 1) - (b.margemPct ?? 1),
    giro: (a, b) => b.giroMes - a.giroMes,
    excesso: (a, b) => ((b.estoqueAtual ?? 0) - b.estoqueMax) * b.custoMedio - ((a.estoqueAtual ?? 0) - a.estoqueMax) * a.custoMedio,
  }
  lista = lista.slice().sort(ordenadores[sort] ?? ordenadores.compra)

  // Última importação de cada relatório da unidade
  const imports = await prisma.stockImport.findMany({
    where: { unitId: daLoja.unitId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const atualizadoEm: Record<string, string> = {}
  imports.forEach(i => { if (!atualizadoEm[i.kind]) atualizadoEm[i.kind] = i.createdAt.toISOString() })

  return NextResponse.json({
    settings,
    unidades,
    unitId: daLoja.unitId,
    painel,
    diasDiario: daLoja.diasDiario,
    modoSigma: daLoja.diasDiario >= params.minDiasDiario,
    contagens,
    totalProdutos: lista.length,
    produtos: lista.slice(0, MAX_PRODUTOS),
    atualizadoEm,
  })
}
