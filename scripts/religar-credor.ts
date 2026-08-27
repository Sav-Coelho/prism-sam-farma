/**
 * Religa lançamentos que entraram sem conta.
 *
 * O ERP deixa a coluna "Plano de Contas" vazia em algumas linhas; nesses casos
 * a chave do De-Para é o nome do credor. Este script aplica essa regra ao que
 * já está no banco (o parser passou a fazer isso sozinho nas próximas cargas).
 */
import { PrismaClient } from '@prisma/client'
import { CAT, typeForGroup } from '../src/lib/dre'

const prisma = new PrismaClient({ log: ['error'] })
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function proximoCodigo(prefixo: string): Promise<string> {
  const existentes = await prisma.account.findMany({
    where: { code: { startsWith: prefixo + '.' } }, select: { code: true },
  })
  const nums = existentes.map(a => parseInt(a.code.split('.').pop() || '0') || 0)
  return prefixo + '.' + String((nums.length ? Math.max.apply(null, nums) : 0) + 1).padStart(2, '0')
}

async function main() {
  const orfas = await prisma.transaction.findMany({
    where: { accountId: null },
    select: { id: true, description: true, amount: true, month: true, year: true },
  })
  const total = orfas.reduce((s, t) => s + Math.abs(t.amount), 0)
  console.log(orfas.length + ' lançamentos sem conta · R$ ' + brl(total))
  if (orfas.length === 0) return

  // Agrupa por credor para resolver cada chave uma única vez
  const porCredor = new Map<string, number[]>()
  orfas.forEach(t => {
    const k = (t.description || '').trim()
    const lista = porCredor.get(k) ?? []
    lista.push(t.id)
    porCredor.set(k, lista)
  })
  console.log(porCredor.size + ' credores distintos\n')

  let religados = 0, viaDePara = 0, novas = 0
  for (const [credor, ids] of Array.from(porCredor.entries())) {
    if (!credor) continue
    let conta = await prisma.account.findUnique({ where: { erpKey: credor } })
    if (conta) {
      viaDePara++
    } else {
      conta = await prisma.account.create({
        data: {
          code: await proximoCodigo('9.1'),
          name: credor.slice(0, 80),
          erpKey: credor,
          dreGroup: CAT.A_CLASSIFICAR,
          type: typeForGroup(CAT.A_CLASSIFICAR),
        },
      })
      novas++
    }
    const r = await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { accountId: conta.id } })
    religados += r.count
    const marca = viaDePara && conta.dreGroup !== CAT.A_CLASSIFICAR ? '✓' : '⚠'
    console.log('  ' + marca + ' ' + credor.slice(0, 44).padEnd(46) + String(ids.length).padStart(4) + ' lanç. → ' + conta.dreGroup)
  }
  console.log('\n' + religados + ' lançamentos religados · ' + viaDePara + ' credores achados no De-Para · ' + novas + ' criados como A Classificar')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
