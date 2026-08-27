/** Compara a DRE calculada pelo sistema com os números da planilha do cliente. */
import { PrismaClient } from '@prisma/client'
import { calcDRE } from '../src/lib/dre'

const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Julho/2026 conforme a aba "DRE Gerencial" enviada pelo cliente
const ALVO: Record<string, number> = {
  receitaBruta: 527496.96,
  cmv: 353380.15,
  margemContribuicao: 174116.81,
  lucroOperacional: 75616.97,
  impostos: 15514.95,
  ebitda: 60102.02,
  financeiras: 15495.19,
  lucroLiquido: 44606.83,
  aClassificar: 487.61,
}

async function main() {
  const mes = 7, ano = 2026
  const txs = await prisma.transaction.findMany({
    where: { month: mes, year: ano, accountId: { not: null }, status: 'REALIZADO' },
    include: { account: true },
  })
  console.log('lançamentos de ' + mes + '/' + ano + ': ' + txs.length + '\n')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dre = calcDRE(txs as any, mes, ano)

  const linhas: [string, number, number | undefined][] = [
    ['Receita Operacional Bruta', dre.receitaBruta, ALVO.receitaBruta],
    ['(-) CMV', dre.cmv, ALVO.cmv],
    ['(=) Margem de Contribuição', dre.margemContribuicao, ALVO.margemContribuicao],
    ['(-) Despesas Administrativas', dre.lines.filter(l => l.label.includes('Administrativas'))[0]?.value ?? 0, -44060.74],
    ['(-) Despesas com Pessoal', dre.lines.filter(l => l.label.includes('com Pessoal'))[0]?.value ?? 0, -41431.32],
    ['(-) Despesas Logísticas', dre.lines.filter(l => l.label.includes('Logísticas'))[0]?.value ?? 0, -10048.00],
    ['(-) Despesas Comerciais', dre.lines.filter(l => l.label.includes('Comerciais'))[0]?.value ?? 0, -2959.78],
    ['(=) Lucro Operacional', dre.lucroOperacional, ALVO.lucroOperacional],
    ['(-) Impostos', dre.impostos, ALVO.impostos],
    ['(=) EBITDA', dre.ebitda, ALVO.ebitda],
    ['(-) Despesas Financeiras', dre.financeiras, ALVO.financeiras],
    ['(=) LUCRO LÍQUIDO GERENCIAL', dre.lucroLiquido, ALVO.lucroLiquido],
    ['A Classificar (memo)', dre.aClassificar, ALVO.aClassificar],
  ]

  let ok = 0, div = 0
  linhas.forEach(([nome, sistema, alvo]) => {
    const bate = alvo === undefined || Math.abs(Math.abs(sistema) - Math.abs(alvo)) < 0.02
    if (alvo !== undefined) { bate ? ok++ : div++ }
    console.log(
      nome.padEnd(32),
      'sistema:' + brl(sistema).padStart(14),
      alvo !== undefined ? ' planilha:' + brl(alvo).padStart(14) + '  ' + (bate ? 'OK' : '<<< DIVERGE') : ''
    )
  })
  console.log('\n' + ok + ' linhas conferem, ' + div + ' divergem')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
