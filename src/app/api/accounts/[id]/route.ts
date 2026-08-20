import { prisma } from '@/lib/prisma'
import { ACCOUNT_TYPES, ALL_DRE_GROUPS, isValidDreGroup } from '@/lib/dre'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()

  if ('dreGroup' in body && !isValidDreGroup(body.dreGroup)) {
    return NextResponse.json(
      { error: `Grupo DRE inválido: "${body.dreGroup}". Válidos: ${ALL_DRE_GROUPS.join(' · ')}` },
      { status: 400 }
    )
  }
  if ('type' in body && ACCOUNT_TYPES.indexOf(body.type) < 0) {
    return NextResponse.json(
      { error: `Tipo inválido: "${body.type}". Válidos: ${ACCOUNT_TYPES.join(' · ')}` },
      { status: 400 }
    )
  }

  const data: Record<string, unknown> = {}
  for (const field of ['code', 'name', 'type', 'dreGroup', 'active']) {
    if (field in body) data[field] = body[field]
  }
  try {
    const account = await prisma.account.update({ where: { id: parseInt(params.id) }, data })
    return NextResponse.json(account)
  } catch {
    return NextResponse.json({ error: 'Código já existe ou conta não encontrada' }, { status: 409 })
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const inUse = await prisma.transaction.findFirst({ where: { accountId: id } })
  if (inUse) {
    return NextResponse.json({ error: 'Conta possui lançamentos vinculados' }, { status: 409 })
  }
  await prisma.account.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
