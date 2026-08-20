import { prisma } from '@/lib/prisma'
import { calcDRE } from '@/lib/dre'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/dre?month=5&year=2026[&unitId=1]
 * month=0 → DRE consolidado do ano inteiro.
 * Retorna { dre, yearData } — yearData tem os 12 meses para os gráficos.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = parseInt(searchParams.get('month') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  const unitId = searchParams.get('unitId')

  if (!year) {
    return NextResponse.json({ error: 'year é obrigatório' }, { status: 400 })
  }

  const unitFilter = unitId ? { unitId: parseInt(unitId) } : {}
  const monthFilter = month > 0 ? { month } : {}

  const transactions = await prisma.transaction.findMany({
    where: { ...monthFilter, year, accountId: { not: null }, ...unitFilter },
    include: { account: true }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dre = calcDRE(transactions as any, month, year)

  // Um único SELECT do ano; o agrupamento por mês é feito em memória
  const yearTxs = await prisma.transaction.findMany({
    where: { year, accountId: { not: null }, ...unitFilter },
    include: { account: true }
  })

  const yearData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return calcDRE(yearTxs.filter(t => t.month === m) as any, m, year)
  })

  return NextResponse.json({ dre, yearData })
}
