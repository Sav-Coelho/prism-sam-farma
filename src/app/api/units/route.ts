import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const units = await prisma.unit.findMany({
    include: { bankAccounts: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' }
  })
  return NextResponse.json(units)
}

export async function POST(req: Request) {
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  try {
    const unit = await prisma.unit.create({ data: { name: name.trim().toUpperCase() } })
    return NextResponse.json(unit, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Nome já existe' }, { status: 409 })
  }
}
