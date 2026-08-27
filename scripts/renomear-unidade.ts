/** Padroniza o nome da unidade que veio do ERP sem hífen no apelido. */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient({ log: ['error'] })
async function main() {
  const alvo = await prisma.unit.findFirst({ where: { name: 'FARMA & FARMA REPRESENTAÇÕES' } })
  if (!alvo) { console.log('nada a renomear'); return }
  const conflito = await prisma.unit.findFirst({ where: { name: 'REPRESENTAÇÕES' } })
  if (conflito) { console.log('já existe unidade REPRESENTAÇÕES (id ' + conflito.id + ')'); return }
  const n = await prisma.transaction.count({ where: { unitId: alvo.id } })
  await prisma.unit.update({ where: { id: alvo.id }, data: { name: 'REPRESENTAÇÕES' } })
  console.log('unidade ' + alvo.id + ' renomeada para REPRESENTAÇÕES · ' + n + ' lançamentos mantidos')
  const todas = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
  console.log('unidades agora: ' + todas.map(u => u.name).join(' · '))
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
