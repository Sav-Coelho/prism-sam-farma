/**
 * Funde os canais de receita duplicados.
 *
 * A base histórica e a planilha mensal escrevem o mesmo canal de formas
 * diferentes ("Recebimento RedeMatriz" × "Cartão – Rede"), o que partia a linha
 * da DRE no meio do ano. Aqui cada grupo vira uma conta só, com a grafia da
 * planilha do cliente. O parser já normaliza nas próximas cargas.
 */
import { PrismaClient } from '@prisma/client'
import { CAT } from '../src/lib/dre'
import { canalCanonico } from '../src/lib/erp-import'

const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function main() {
  const contas = await prisma.account.findMany({ where: { dreGroup: CAT.RECEITA }, orderBy: { code: 'asc' } })
  const grupos = new Map<string, typeof contas>()
  contas.forEach(c => {
    const nome = canalCanonico(c.name)
    grupos.set(nome, (grupos.get(nome) ?? []).concat([c]))
  })

  let fundidas = 0, movidos = 0
  for (const [canonico, lista] of Array.from(grupos.entries())) {
    const alvo = lista[0]
    if (alvo.name !== canonico) {
      await prisma.account.update({ where: { id: alvo.id }, data: { name: canonico } })
    }
    for (const dup of lista.slice(1)) {
      const r = await prisma.transaction.updateMany({ where: { accountId: dup.id }, data: { accountId: alvo.id } })
      await prisma.account.delete({ where: { id: dup.id } })
      movidos += r.count
      fundidas++
      console.log('  ' + dup.name.padEnd(44) + ' → ' + canonico + '  (' + r.count + ' lanç.)')
    }
  }

  console.log('\n' + fundidas + ' contas duplicadas removidas · ' + movidos + ' lançamentos movidos')
  const finais = await prisma.account.findMany({ where: { dreGroup: CAT.RECEITA }, orderBy: { code: 'asc' } })
  console.log('\nCanais agora (' + finais.length + '):')
  for (const c of finais) {
    const ag = await prisma.transaction.aggregate({ where: { accountId: c.id }, _sum: { amount: true }, _count: true })
    console.log('  ' + c.name.padEnd(34) + String(ag._count).padStart(3) + ' lanç. ' + brl(ag._sum.amount ?? 0).padStart(14))
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
