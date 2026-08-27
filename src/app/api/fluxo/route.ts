import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface MesFluxo {
  month: number
  year: number
  entradas: number
  saidas: number
  saldo: number
  acumulado: number
  titulos: number
  vencido: number
}

/**
 * GET /api/fluxo?year=2026[&unitId=1]
 *
 * Fluxo de caixa projetado: tudo que está PENDENTE, agrupado pelo mês de
 * vencimento. Saídas vêm das contas a pagar futuras; entradas, dos recebíveis.
 * `saldoInicial` é a soma dos saldos iniciais das contas bancárias.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') || '0')
  const unitId = searchParams.get('unitId')
  if (!year) return NextResponse.json({ error: 'year é obrigatório' }, { status: 400 })

  const unitFilter = unitId ? { unitId: parseInt(unitId) } : {}

  const pendentes = await prisma.transaction.findMany({
    where: { status: 'PENDENTE', ...unitFilter },
    include: { account: true, unit: true },
    orderBy: { dueDate: 'asc' },
  })

  const contas = await prisma.bankAccount.findMany({ where: unitId ? { unitId: parseInt(unitId) } : {} })
  const saldoInicial = contas.reduce((s, c) => s + (c.initialBalance || 0), 0)

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const meses: MesFluxo[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, year, entradas: 0, saidas: 0, saldo: 0, acumulado: 0, titulos: 0, vencido: 0,
  }))

  pendentes.forEach(t => {
    const venc = t.dueDate ?? t.date
    if (venc.getFullYear() !== year) return
    const alvo = meses[venc.getMonth()]
    alvo.titulos++
    if (t.amount >= 0) alvo.entradas += t.amount
    else {
      alvo.saidas += Math.abs(t.amount)
      if (venc < hoje) alvo.vencido += Math.abs(t.amount)
    }
  })

  let acumulado = saldoInicial
  meses.forEach(m => {
    m.saldo = m.entradas - m.saidas
    acumulado += m.saldo
    m.acumulado = acumulado
  })

  // Maiores compromissos futuros, para a tabela de detalhe
  const detalhe = pendentes
    .filter(t => t.amount < 0 && (t.dueDate ?? t.date).getFullYear() === year)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 100)
    .map(t => ({
      id: t.id,
      descricao: t.description,
      valor: t.amount,
      vencimento: (t.dueDate ?? t.date).toISOString(),
      categoria: t.account?.dreGroup ?? 'Sem categoria',
      conta: t.account?.name ?? null,
      unidade: t.unit?.name ?? null,
      vencido: (t.dueDate ?? t.date) < hoje,
    }))

  const totalEntradas = meses.reduce((s, m) => s + m.entradas, 0)
  const totalSaidas = meses.reduce((s, m) => s + m.saidas, 0)

  return NextResponse.json({
    year,
    saldoInicial,
    meses,
    detalhe,
    totalEntradas,
    totalSaidas,
    totalTitulos: pendentes.length,
    vencido: meses.reduce((s, m) => s + m.vencido, 0),
  })
}
