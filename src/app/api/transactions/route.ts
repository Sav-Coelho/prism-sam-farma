import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')
  const unitId = searchParams.get('unitId')

  const where: Record<string, unknown> = {}
  if (month) where.month = parseInt(month)
  if (year) where.year = parseInt(year)
  if (unitId) where.unitId = parseInt(unitId)

  const transactions = await prisma.transaction.findMany({
    where,
    include: { account: true, unit: true, bankAccount: true },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json(transactions)
}

/** Lançamento manual. A competência (month/year) vem do próprio `date`. */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { date, description, amount, accountId, memo, unitId, bankAccountId } = body

  if (!date || !description || amount == null) {
    return NextResponse.json({ error: 'Data, descrição e valor são obrigatórios' }, { status: 400 })
  }

  const d = new Date(date)
  if (isNaN(d.getTime())) {
    return NextResponse.json({ error: 'Data inválida' }, { status: 400 })
  }

  const tx = await prisma.transaction.create({
    data: {
      date: d,
      description,
      amount: parseFloat(amount),
      memo: memo || description,
      accountId: accountId ? parseInt(accountId) : null,
      unitId: unitId ? parseInt(unitId) : null,
      bankAccountId: bankAccountId ? parseInt(bankAccountId) : null,
      month: d.getMonth() + 1,
      year: d.getFullYear()
    },
    include: { account: true, unit: true }
  })
  return NextResponse.json(tx, { status: 201 })
}
