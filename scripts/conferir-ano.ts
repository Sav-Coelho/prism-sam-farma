/** Confere os 7 meses fechados do sistema contra a planilha do cliente. */
import { PrismaClient } from '@prisma/client'
import { calcDRE } from '../src/lib/dre'

const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(13)

// Linhas 15, 18, 35, 36, 138, 161, 169, 181, 182, 192, 193, 215 da aba "DRE Gerencial"
const P: Record<string, number[]> = {
  receitaBruta:       [455975.80, 411716.23, 483378.56, 461765.74, 457524.53, 507124.60, 527496.96],
  cmv:                [365909.99, 350225.54, 367866.46, 433449.14, 416143.98, 418266.07, 353380.15],
  margemContribuicao: [ 90065.81,  61490.69, 115512.10,  28316.60,  41380.55,  88858.53, 174116.81],
}

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { year: 2026, accountId: { not: null }, status: 'REALIZADO' },
    include: { account: true },
  })
  const M = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul']
  let ok = 0, div = 0
  Object.keys(P).forEach(chave => {
    console.log('=== ' + chave)
    M.forEach((nome, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = calcDRE(txs.filter(t => t.month === i + 1) as any, i + 1, 2026) as any
      const sis = d[chave] as number
      const alvo = P[chave][i]
      const bate = Math.abs(sis - alvo) < 0.02
      bate ? ok++ : div++
      console.log('  ' + nome, brl(sis), brl(alvo), bate ? 'OK' : '<<< dif ' + brl(sis - alvo))
    })
  })
  console.log('\n' + ok + ' conferem · ' + div + ' divergem')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
