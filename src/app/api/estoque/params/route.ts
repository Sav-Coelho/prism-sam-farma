import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** Parâmetros do motor de estoque (linha única) — réplica da aba "Parâmetros". */
export async function GET() {
  const settings = await prisma.stockSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
  return NextResponse.json(settings)
}

const CAMPOS_NUM = [
  'metaMargem', 'pctCustosVar', 'custoFixoMensal', 'leadTimeDias', 'cicloDias',
  'nivelServicoZ', 'segurancaDias', 'periodoMeses', 'minDiasDiario', 'benchmarkMargem',
]

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const data: Record<string, unknown> = {}

  for (const campo of CAMPOS_NUM) {
    if (!(campo in body)) continue
    const v = parseFloat(String(body[campo]))
    if (!isFinite(v) || v < 0) {
      return NextResponse.json({ error: `Valor inválido em ${campo}` }, { status: 400 })
    }
    data[campo] = campo === 'minDiasDiario' ? Math.round(v) : v
  }
  if ('categoriasExcluidas' in body) {
    data.categoriasExcluidas = String(body.categoriasExcluidas)
      .split(/[|;\n]/).map(s => s.trim()).filter(Boolean).join('|')
  }

  const settings = await prisma.stockSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  })
  return NextResponse.json(settings)
}
