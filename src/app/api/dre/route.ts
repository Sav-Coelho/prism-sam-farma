import { prisma } from '@/lib/prisma'
import { calcDRE, montarMatrizAnual } from '@/lib/dre'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/dre?year=2026[&month=7][&unitId=1]
 *
 * Retorna `{ dre, anual, yearData, matriz }`:
 *  - `dre`      → DRE do mês pedido (`month=0` = ano inteiro)
 *  - `anual`    → DRE consolidada do ano
 *  - `yearData` → as 12 DREs mensais
 *  - `matriz`   → linhas da DRE com jan…dez lado a lado (a tabela grande)
 *
 * Só entra `status = REALIZADO` — a DRE é em regime de caixa.
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

  // Um único SELECT do ano; o recorte por mês é feito em memória
  const yearTxs = await prisma.transaction.findMany({
    where: { year, accountId: { not: null }, status: 'REALIZADO', ...unitFilter },
    include: { account: true }
  })

  const yearData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return calcDRE(yearTxs.filter(t => t.month === m) as any, m, year)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anual = calcDRE(yearTxs as any, 0, year)
  const dre = month > 0 ? yearData[month - 1] : anual
  const matriz = montarMatrizAnual(anual, yearData)

  return NextResponse.json({ dre, anual, yearData, matriz })
}
