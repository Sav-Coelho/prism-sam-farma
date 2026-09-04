/**
 * Valida o motor de Estoque & Compras contra a planilha da Brave: compara o
 * cálculo do sistema com os valores CALCULADOS pela própria planilha.
 *
 * Uma aba por execução (RAM limitada):
 *   node .backfill-out/scripts/validar-estoque.js "<planilha.xlsx>" Igarassu IGARASSU
 *   node .backfill-out/scripts/validar-estoque.js "<planilha.xlsx>" Goiana GOIANA
 *   node .backfill-out/scripts/validar-estoque.js "<planilha.xlsx>" Painel
 */
import * as XLSX from 'xlsx'
import { prisma } from '../src/lib/prisma'
import { normalizarBarcode } from '../src/lib/estoque-import'
import {
  calcularPainel, calcularProdutos, paramsDeSettings,
  type EstoqueEntrada, type ProdutoCalc, type VendaEntrada,
} from '../src/lib/estoque'

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

function lerAba(caminho: string, aba: string): string[][] {
  const wb = XLSX.readFile(caminho, { cellDates: false, cellFormula: false, cellStyles: false, raw: true, sheets: [aba] } as XLSX.ParsingOptions)
  const sheet = wb.Sheets[aba]
  if (!sheet) { console.error('Aba não encontrada: ' + aba); process.exit(1) }
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '', raw: true })
    .map(l => (l as unknown[]).map(c => String(c ?? '').trim()))
}

const numOuNull = (s: string): number | null => {
  if (s === '' || s === '-') return null
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

/** Produtos calculados pelo sistema para uma unidade (mesma montagem da API). */
async function produtosDoSistema(unidadeNome: string): Promise<{ produtos: ProdutoCalc[]; diasDiario: number }> {
  const settings = await prisma.stockSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
  const params = paramsDeSettings(settings)
  const unit = await prisma.unit.findFirst({ where: { name: unidadeNome } })
  if (!unit) { console.error('Unidade não encontrada: ' + unidadeNome); process.exit(1) }

  const vendas = await prisma.salesItem.findMany({
    where: { unitId: unit.id },
    include: { product: { select: { barcode: true, name: true } } },
  })
  const estoque = await prisma.stockPosition.findMany({
    where: { unitId: unit.id },
    select: { productId: true, qty: true, price: true, cost: true, abc: true, category: true },
  })
  const diario = await prisma.dailySale.aggregate({ where: { unitId: unit.id }, _min: { date: true }, _max: { date: true } })
  const diasDiario = diario._min.date && diario._max.date
    ? Math.round((diario._max.date.getTime() - diario._min.date.getTime()) / 86400000) + 1
    : 0

  const estoquePorProduto: Record<number, EstoqueEntrada> = {}
  estoque.forEach(e => { estoquePorProduto[e.productId] = e })

  const entradas: VendaEntrada[] = vendas.map(v => ({
    productId: v.productId, barcode: v.product.barcode, name: v.product.name,
    abc: v.abc, qty: v.qty, revenue: v.revenue, custoVendas: v.cost,
  }))
  return { produtos: calcularProdutos(entradas, estoquePorProduto, {}, diasDiario, params), diasDiario }
}

async function validarLoja(caminho: string, aba: string, unidadeNome: string) {
  const linhas = lerAba(caminho, aba)
  const { produtos, diasDiario } = await produtosDoSistema(unidadeNome)
  const porBarcode: Record<string, ProdutoCalc> = {}
  produtos.forEach(p => { porBarcode[p.barcode] = p })

  console.log(aba + ' (planilha) × ' + unidadeNome + ' (sistema) · ' + produtos.length + ' produtos no sistema · diário: ' + diasDiario + ' dia(s)')

  // Barcodes que aparecem 2+ vezes na planilha (o sistema soma; compara só o agregado)
  const vezes: Record<string, number> = {}
  for (let r = 2; r < linhas.length; r++) {
    const b = normalizarBarcode(linhas[r][1] ?? '')
    if (b && String(linhas[r][0] ?? '').trim()) vezes[b] = (vezes[b] || 0) + 1
  }

  let ok = 0, div = 0, semPar = 0, duplicados = 0
  const problemas: string[] = []
  const anota = (barcode: string, nome: string, campo: string, sis: string, plan: string) => {
    div++
    if (problemas.length < 40) {
      problemas.push(nome.slice(0, 34).padEnd(36) + campo.padEnd(14) + 'sistema ' + sis.padStart(13) + '   planilha ' + plan.padStart(13))
    }
  }

  for (let r = 2; r < linhas.length; r++) {
    const l = linhas[r]
    if (!String(l[0] ?? '').trim()) continue
    const barcode = normalizarBarcode(l[1] ?? '')
    if (!barcode) continue
    const p = porBarcode[barcode]
    if (!p) { semPar++; continue }
    if (vezes[barcode] > 1) { duplicados++; continue }  // linha partida na planilha — sistema soma

    // [campo, valor do sistema, valor da planilha, tolerância]
    const numericos: [string, number | null, number | null, number][] = [
      ['qtd', p.qtdVendida, numOuNull(l[4]), 0.01],
      ['faturamento', p.faturamento, numOuNull(l[5]), 0.02],
      ['preço médio', p.precoMedio, numOuNull(l[6]), 0.01],
      ['custo médio', p.custoMedio, numOuNull(l[7]), 0.01],
      ['margem %', p.margemPct, numOuNull(l[8]), 0.0005],
      ['MC %', p.mcPct, numOuNull(l[9]), 0.0005],
      ['preço sug.', p.precoSugerido, numOuNull(l[10]), 0.01],
      ['custo-alvo', p.custoAlvo, numOuNull(l[11]), 0.01],
      ['giro/mês', p.giroMes, numOuNull(l[12]), 0.005],
      ['estoque', p.estoqueAtual, numOuNull(l[14]), 0.01],
      ['mín', p.estoqueMin, numOuNull(l[15]), 0],
      ['máx', p.estoqueMax, numOuNull(l[16]), 0],
      ['sug. compra', p.sugestaoCompra, numOuNull(l[17]), 0],
    ]
    let linhaOk = true
    numericos.forEach(([campo, sis, plan, tol]) => {
      const ambosVazios = (sis === null || sis === undefined) && plan === null
      if (ambosVazios) return
      if (sis === null || sis === undefined || plan === null || Math.abs(sis - plan) > tol) {
        linhaOk = false
        anota(barcode, p.name, campo, sis == null ? '(vazio)' : brl(sis), plan == null ? '(vazio)' : brl(plan))
      }
    })
    const sitPlan = String(l[18] ?? '').trim()
    if (sitPlan && sitPlan !== p.situacao) {
      linhaOk = false
      anota(barcode, p.name, 'situação', p.situacao, sitPlan)
    }
    if (linhaOk) ok++
  }

  console.log(ok + ' produtos conferem em todos os campos · ' + div + ' campos divergem · '
    + semPar + ' linhas da planilha sem par · ' + duplicados + ' com linha partida (agregados no sistema)')
  if (problemas.length) {
    console.log('\nDIVERGÊNCIAS:')
    problemas.forEach(p => console.log('  ' + p))
    if (div > problemas.length) console.log('  ... e mais ' + (div - problemas.length))
  }
  if (div > 0) process.exitCode = 1
}

async function validarPainel(caminho: string) {
  const linhas = lerAba(caminho, 'Painel')
  const cel = (r: number, c: number) => String(linhas[r]?.[c] ?? '').trim()

  const settings = await prisma.stockSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
  const params = paramsDeSettings(settings)
  const lojas: { unitId: number; nome: string; faturamento: number; lucro: number }[] = []
  for (const nome of ['IGARASSU', 'GOIANA']) {
    const { produtos } = await produtosDoSistema(nome)
    lojas.push({
      unitId: lojas.length + 1,
      nome,
      faturamento: produtos.reduce((s, p) => s + (p.elegivel ? p.faturamento : 0), 0),
      lucro: produtos.reduce((s, p) => s + (p.elegivel ? p.lucro : 0), 0),
    })
  }
  const painel = calcularPainel(lojas, params)

  // O range exportado começa na coluna B: rótulos no índice 0/4, valores no 2 (IGA), 6 (GOI)
  // e 4 (agregado). As linhas são localizadas pelo rótulo, não pela posição.
  const achar = (rotulo: string, apos = 0) => {
    for (let r = apos; r < linhas.length; r++) {
      if (cel(r, 0).toLowerCase().indexOf(rotulo) === 0) return r
    }
    return -1
  }
  const alvo = (r: number, c: number) => (r < 0 ? null : numOuNull(cel(r, c)))
  const idxAgregado = achar('agregado')

  const casos: [string, number | null, number | null, number][] = []
  const lojaPlan = (col: number, l: typeof painel.lojas[0]) => {
    casos.push(
      [l.nome + ' faturamento', l.faturamentoTotal, alvo(achar('faturamento total'), col), 0.05],
      [l.nome + ' fat/mês', l.faturamentoMedioMensal, alvo(achar('faturamento médio mensal'), col), 0.05],
      [l.nome + ' margem bruta', l.margemBruta, alvo(achar('margem bruta realizada'), col), 0.0005],
      [l.nome + ' MC', l.margemContribuicao, alvo(achar('margem de contribuição'), col), 0.0005],
      [l.nome + ' custo fixo rateado', l.custoFixoRateado, alvo(achar('custo fixo rateado'), col), 0.05],
      [l.nome + ' ponto de equilíbrio', l.pontoEquilibrio, alvo(achar('ponto de equilíbrio'), col), 1],
      [l.nome + ' vs benchmark', l.vsBenchmark, alvo(achar('vs benchmark'), col), 0.0005],
    )
  }
  lojaPlan(2, painel.lojas[0])
  lojaPlan(6, painel.lojas[1])
  casos.push(['agregado faturamento', painel.agregado.faturamentoCombinado, alvo(achar('faturamento combinado', idxAgregado), 4), 0.05])
  casos.push(['agregado fat/mês', painel.agregado.faturamentoMedioMensal, alvo(achar('faturamento médio mensal', idxAgregado), 4), 0.05])

  let ok = 0, div = 0
  casos.forEach(([nome, sis, plan, tol]) => {
    const ambosNulos = sis === null && plan === null
    const bate = ambosNulos || (sis !== null && plan !== null && Math.abs(sis - plan) <= tol)
    if (bate) { ok++ } else {
      div++
      console.log('  DIVERGE ' + nome.padEnd(30) + 'sistema ' + (sis === null ? 'n/d' : brl(sis)).padStart(15) + '   planilha ' + (plan === null ? 'n/d' : brl(plan)).padStart(15))
    }
  })
  console.log('Painel: ' + ok + ' valores conferem · ' + div + ' divergem')
  if (div > 0) process.exitCode = 1
}

async function main() {
  const caminho = process.argv[2]
  const aba = process.argv[3]
  const unidade = (process.argv[4] || '').toUpperCase()
  if (!caminho || !aba) { console.error('Uso: validar-estoque <planilha.xlsx> <aba> [unidade]'); process.exit(1) }
  if (aba === 'Painel') await validarPainel(caminho)
  else await validarLoja(caminho, aba, unidade)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
