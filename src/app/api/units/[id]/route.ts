import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  try {
    const unit = await prisma.unit.update({
      where: { id },
      data: { name: name.trim().toUpperCase() },
    })
    return NextResponse.json(unit)
  } catch {
    return NextResponse.json({ error: 'Nome já existe ou unidade não encontrada' }, { status: 409 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const hasTx = await prisma.transaction.findFirst({ where: { unitId: id } })
  if (hasTx) return NextResponse.json({ error: 'Unidade possui lançamentos vinculados' }, { status: 409 })
  const hasEstoque = await prisma.stockPosition.findFirst({ where: { unitId: id } })
    ?? await prisma.salesItem.findFirst({ where: { unitId: id } })
  if (hasEstoque) return NextResponse.json({ error: 'Unidade possui dados de estoque/vendas vinculados' }, { status: 409 })
  await prisma.bankAccount.deleteMany({ where: { unitId: id } })
  await prisma.unit.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
