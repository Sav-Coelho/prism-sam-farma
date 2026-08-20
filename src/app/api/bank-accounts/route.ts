import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { name, unitId, initialBalance } = await req.json()
  if (!name?.trim() || !unitId) {
    return NextResponse.json({ error: 'Nome e unidade obrigatórios' }, { status: 400 })
  }
  const account = await prisma.bankAccount.create({
    data: {
      name: name.trim(),
      unitId: parseInt(unitId),
      initialBalance: parseFloat(initialBalance) || 0,
    },
  })
  return NextResponse.json(account, { status: 201 })
}
