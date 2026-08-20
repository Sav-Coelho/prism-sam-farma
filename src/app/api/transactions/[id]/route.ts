import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

/** PUT — usado para (re)classificar um lançamento e ajustar a competência. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const data: Record<string, unknown> = {}

  if ('accountId' in body) data.accountId = body.accountId ? parseInt(body.accountId) : null
  if ('unitId' in body) data.unitId = body.unitId ? parseInt(body.unitId) : null
  if ('bankAccountId' in body) data.bankAccountId = body.bankAccountId ? parseInt(body.bankAccountId) : null
  if (body.month) data.month = parseInt(body.month)
  if (body.year) data.year = parseInt(body.year)
  if (body.description) data.description = body.description

  const tx = await prisma.transaction.update({
    where: { id: parseInt(params.id) },
    data,
    include: { account: true, unit: true }
  })
  return NextResponse.json(tx)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.transaction.delete({ where: { id: parseInt(params.id) } })
  return NextResponse.json({ ok: true })
}
