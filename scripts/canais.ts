import { PrismaClient } from '@prisma/client'
import { CAT } from '../src/lib/dre'
const prisma = new PrismaClient({ log: ['error'] })
async function main() {
  const contas = await prisma.account.findMany({ where: { dreGroup: CAT.RECEITA }, orderBy: { code: 'asc' } })
  for (const c of contas) {
    const ag = await prisma.transaction.aggregate({ where: { accountId: c.id }, _sum: { amount: true }, _count: true })
    const meses = await prisma.transaction.findMany({
      where: { accountId: c.id }, select: { month: true }, distinct: ['month'], orderBy: { month: 'asc' },
    })
    console.log(
      c.code.padEnd(8), c.name.padEnd(44),
      String(ag._count).padStart(3) + ' lanç.',
      (ag._sum.amount ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(14),
      ' meses: ' + meses.map(m => m.month).join(','))
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
