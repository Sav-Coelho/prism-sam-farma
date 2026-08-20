import { prisma } from '@/lib/prisma'
import { ACCOUNT_TYPES, ALL_DRE_GROUPS, isValidDreGroup } from '@/lib/dre'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(accounts)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { code, name, type, dreGroup } = body

  if (!code || !name || !type || !dreGroup) {
    return NextResponse.json({ error: 'Campos obrigatórios' }, { status: 400 })
  }

  // Um dreGroup fora da lista não é posicionável na DRE — barra antes de gravar
  if (!isValidDreGroup(dreGroup)) {
    return NextResponse.json(
      { error: `Grupo DRE inválido: "${dreGroup}". Válidos: ${ALL_DRE_GROUPS.join(' · ')}` },
      { status: 400 }
    )
  }
  if (ACCOUNT_TYPES.indexOf(type) < 0) {
    return NextResponse.json(
      { error: `Tipo inválido: "${type}". Válidos: ${ACCOUNT_TYPES.join(' · ')}` },
      { status: 400 }
    )
  }

  try {
    const account = await prisma.account.create({
      data: { code: String(code).trim(), name: String(name).trim(), type, dreGroup }
    })
    return NextResponse.json(account, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Código já existe' }, { status: 409 })
  }
}
