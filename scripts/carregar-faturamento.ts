/**
 * Carrega a aba Base_Vendas (faturamento e CMV por loja/mês).
 *
 * É a base do rateio da receita por unidade: os recebimentos chegam
 * consolidados, sem loja, então cada unidade recebe a fatia da receita
 * proporcional à sua participação no faturamento do mês.
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { parseNumberBR } from '../src/lib/import-mapper'
import { nomeUnidade } from '../src/lib/erp-sync'

const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function main() {
  const caminho = process.argv[2]
  if (!caminho) { console.error('Informe o caminho do arquivo da DRE'); process.exit(1) }

  const wb = XLSX.readFile(caminho, { cellDates: false, cellFormula: false, cellStyles: false, sheets: ['Base_Vendas'] })
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Base_Vendas'], { header: 1, blankrows: false, defval: '', raw: false })
    .map(l => (l as unknown[]).map(c => String(c ?? '').trim()))

  let gravados = 0
  for (const linha of linhas.slice(1)) {
    const ano = parseInt(linha[0]) || 0
    const mes = parseInt(linha[1]) || 0
    const loja = linha[3]
    const apelido = linha[6]
    if (!ano || !mes || !loja) continue

    const faturamento = parseNumberBR(linha[4].replace(/^R+\$?/i, '')) || 0
    const cmv = parseNumberBR(linha[5].replace(/^R+\$?/i, '')) || 0
    const nome = nomeUnidade(apelido, loja.toUpperCase())

    let unidade = await prisma.unit.findFirst({ where: { name: nome } })
    if (!unidade) unidade = await prisma.unit.create({ data: { name: nome } })

    await prisma.unitSales.upsert({
      where: { unitId_month_year: { unitId: unidade.id, month: mes, year: ano } },
      update: { faturamento, cmv },
      create: { unitId: unidade.id, month: mes, year: ano, faturamento, cmv },
    })
    gravados++
  }

  console.log(gravados + ' linhas de faturamento gravadas\n')
  const todas = await prisma.unitSales.findMany({ include: { unit: true }, orderBy: [{ year: 'asc' }, { month: 'asc' }] })
  const porMes = new Map<string, { nome: string; v: number }[]>()
  todas.forEach(s => {
    const k = s.year + '-' + String(s.month).padStart(2, '0')
    porMes.set(k, (porMes.get(k) ?? []).concat([{ nome: s.unit.name, v: s.faturamento }]))
  })
  Array.from(porMes.entries()).forEach(([k, lista]) => {
    const total = lista.reduce((a, b) => a + b.v, 0)
    console.log(k + '  ' + lista.map(l => l.nome + ' ' + brl(l.v) + ' (' + ((l.v / total) * 100).toFixed(1) + '%)').join('  ·  '))
  })
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
