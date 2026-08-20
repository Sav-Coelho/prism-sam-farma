import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/import/check  { fitids: string[] }
 * Devolve quais chaves já existem no banco — usado para marcar
 * "já importada" na prévia antes de salvar.
 */
export async function POST(req: NextRequest) {
  const { fitids } = await req.json() as { fitids: string[] }
  if (!Array.isArray(fitids) || fitids.length === 0) return NextResponse.json([])

  const existing = await prisma.transaction.findMany({
    where: { fitid: { in: fitids } },
    select: { fitid: true },
  })
  return NextResponse.json(existing.map(e => e.fitid))
}
