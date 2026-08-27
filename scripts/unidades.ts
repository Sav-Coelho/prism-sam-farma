import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
async function main() {
  const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
  for (const u of units) {
    const n = await prisma.transaction.count({ where: { unitId: u.id } })
    const soma = await prisma.transaction.aggregate({ where: { unitId: u.id, status: 'REALIZADO' }, _sum: { amount: true } })
    const meses = await prisma.transaction.findMany({
      where: { unitId: u.id }, select: { month: true, year: true },
      distinct: ['month', 'year'], orderBy: [{ year: 'asc' }, { month: 'asc' }],
    })
    console.log(
      '[' + String(u.id) + '] ' + u.name.padEnd(30),
      String(n).padStart(5) + ' lançamentos',
      '| realizado ' + brl(soma._sum.amount ?? 0).padStart(15),
      '| períodos: ' + meses.map(m => m.month + '/' + m.year).join(', ').slice(0, 60)
    )
  }
  const semUnidade = await prisma.transaction.count({ where: { unitId: null } })
  console.log('\nsem unidade:', semUnidade, '(recebimentos consolidados)')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
