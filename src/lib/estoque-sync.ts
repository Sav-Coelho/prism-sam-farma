/**
 * Gravação dos relatórios de estoque/vendas/diário.
 *
 * Semântica de SUBSTITUIÇÃO — a lição da duplicação de agosto nos pagamentos:
 * reimportar o mesmo relatório (com qualquer nome de arquivo) nunca soma.
 *  - Estoque e Vendas: apagam o snapshot da unidade e regravam.
 *  - Diário: apaga somente os DIAS presentes no arquivo e regrava esses dias.
 */
import { prisma } from './prisma'
import type { DiarioRow, EstoqueRow, VendaItemRow } from './estoque-import'

function lotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** barcode → productId, criando os produtos que faltarem (em lote). */
export async function resolverProdutos(itens: { barcode: string; name: string }[]): Promise<Record<string, number>> {
  const porBarcode: Record<string, string> = {}
  itens.forEach(i => { if (i.barcode && !porBarcode[i.barcode]) porBarcode[i.barcode] = i.name })
  const barcodes = Object.keys(porBarcode)
  const mapa: Record<string, number> = {}

  for (const lote of lotes(barcodes, 5000)) {
    const achados = await prisma.product.findMany({
      where: { barcode: { in: lote } },
      select: { id: true, barcode: true },
    })
    achados.forEach(p => { mapa[p.barcode] = p.id })
  }

  const faltantes = barcodes.filter(b => !mapa[b])
  for (const lote of lotes(faltantes, 5000)) {
    await prisma.product.createMany({
      data: lote.map(b => ({ barcode: b, name: porBarcode[b].slice(0, 120) })),
      skipDuplicates: true,
    })
    const criados = await prisma.product.findMany({
      where: { barcode: { in: lote } },
      select: { id: true, barcode: true },
    })
    criados.forEach(p => { mapa[p.barcode] = p.id })
  }
  return mapa
}

async function registrar(kind: string, unitId: number, fileName: string, rows: number) {
  await prisma.stockImport.create({ data: { kind, unitId, fileName: fileName.slice(0, 180), rows } })
}

export async function importarEstoque(unitId: number, rows: EstoqueRow[], fileName: string) {
  const produtos = await resolverProdutos(rows)
  await prisma.stockPosition.deleteMany({ where: { unitId } })
  let gravados = 0
  for (const lote of lotes(rows, 5000)) {
    const r = await prisma.stockPosition.createMany({
      data: lote.map(x => ({
        productId: produtos[x.barcode],
        unitId,
        abc: x.abc || null,
        category: x.category || null,
        qty: x.qty,
        price: x.price,
        cost: x.cost,
      })),
      skipDuplicates: true,
    })
    gravados += r.count
  }
  await registrar('estoque', unitId, fileName, gravados)
  return gravados
}

export async function importarVendas(unitId: number, rows: VendaItemRow[], fileName: string) {
  const produtos = await resolverProdutos(rows)
  await prisma.salesItem.deleteMany({ where: { unitId } })
  let gravados = 0
  for (const lote of lotes(rows, 5000)) {
    const r = await prisma.salesItem.createMany({
      data: lote.map(x => ({
        productId: produtos[x.barcode],
        unitId,
        abc: x.abc || null,
        qty: x.qty,
        revenue: x.revenue,
        cost: x.cost,
      })),
      skipDuplicates: true,
    })
    gravados += r.count
  }
  await registrar('vendas', unitId, fileName, gravados)
  return gravados
}

export async function importarDiario(unitId: number, rows: DiarioRow[], fileName: string) {
  const produtos = await resolverProdutos(rows)
  const dias = Array.from(new Set(rows.map(r => r.dateISO))).map(d => new Date(d + 'T00:00:00Z'))
  for (const lote of lotes(dias, 200)) {
    await prisma.dailySale.deleteMany({ where: { unitId, date: { in: lote } } })
  }
  let gravados = 0
  for (const lote of lotes(rows, 5000)) {
    const r = await prisma.dailySale.createMany({
      data: lote.map(x => ({
        date: new Date(x.dateISO + 'T00:00:00Z'),
        productId: produtos[x.barcode],
        unitId,
        qty: x.qty,
        revenue: x.revenue,
      })),
      skipDuplicates: true,
    })
    gravados += r.count
  }
  await registrar('diario', unitId, fileName, gravados)
  return gravados
}
