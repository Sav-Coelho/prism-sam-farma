import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { resolverContasErp, resolverContasCanal, resolverUnidades } from '@/lib/erp-sync'
import type { PagamentoRow, RecebimentoRow } from '@/lib/erp-import'

export const runtime = 'nodejs'

interface CorpoPagamentos {
  kind: 'pagamentos'
  rows: PagamentoRow[]
}

interface CorpoRecebimentos {
  kind: 'recebimentos'
  rows: RecebimentoRow[]
  unitId?: string | number | null
}

interface CorpoGenerico {
  kind?: 'generico'
  transactions: { fitid: string; date: string; amount: number; memo: string; accountId?: string | number | null }[]
  unitId?: string | number | null
  bankAccountId?: string | number | null
  overrideMonth?: number | null
  overrideYear?: number | null
}

type Corpo = CorpoPagamentos | CorpoRecebimentos | CorpoGenerico

/**
 * POST /api/import — grava o lote.
 *
 * `fitid` é único: reimportar o mesmo arquivo não duplica nada.
 * Contas a pagar pagas viram REALIZADO (entram na DRE); pendentes viram
 * PENDENTE (entram só no fluxo de caixa projetado).
 */
export async function POST(req: NextRequest) {
  const corpo = await req.json() as Corpo

  if ('kind' in corpo && corpo.kind === 'pagamentos') return salvarPagamentos(corpo)
  if ('kind' in corpo && corpo.kind === 'recebimentos') return salvarRecebimentos(corpo)
  return salvarGenerico(corpo as CorpoGenerico)
}

async function salvarPagamentos(corpo: CorpoPagamentos) {
  const { rows } = corpo
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Nenhum título selecionado' }, { status: 400 })
  }

  const contas = await resolverContasErp(rows.map(r => r.erpKey))
  const unidades = await resolverUnidades(
    rows.map(r => ({ apelido: r.unidadeApelido, codigo: r.unidade }))
  )

  const data = rows.map(r => ({
    fitid: r.fitid,
    date: new Date(r.pagamento ?? r.vencimento),
    dueDate: new Date(r.vencimento),
    description: r.credor,
    memo: [r.credor, r.documento].filter(Boolean).join(' · '),
    amount: r.valor,
    month: r.month,
    year: r.year,
    status: r.status,
    accountId: r.erpKey ? contas[r.erpKey]?.id ?? null : null,
    unitId: unidades[r.unidadeApelido] ?? unidades[r.unidade] ?? null,
  }))

  const resultado = await prisma.transaction.createMany({ data, skipDuplicates: true })
  const novasChaves = Object.keys(contas).filter(k => contas[k].novo)

  return NextResponse.json({
    imported: resultado.count,
    skipped: rows.length - resultado.count,
    realizados: rows.filter(r => r.status === 'REALIZADO').length,
    pendentes: rows.filter(r => r.status === 'PENDENTE').length,
    novasChaves,
  })
}

async function salvarRecebimentos(corpo: CorpoRecebimentos) {
  const { rows, unitId } = corpo
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Nenhum recebimento selecionado' }, { status: 400 })
  }

  const contas = await resolverContasCanal(rows.map(r => r.canal))
  const unit = unitId ? parseInt(String(unitId)) : null

  const data = rows.map(r => {
    // Recebimento agregado do mês: data = último dia da competência
    const fim = new Date(r.year, r.month, 0)
    return {
      fitid: r.fitid,
      date: fim,
      dueDate: fim,
      description: r.canal,
      memo: r.canal + ' · ' + (r.status === 'PENDENTE' ? 'a receber' : 'recebido'),
      amount: Math.abs(r.valor),
      month: r.month,
      year: r.year,
      status: r.status,
      accountId: contas[r.canal.toLowerCase()] ?? null,
      unitId: unit,
    }
  })

  const resultado = await prisma.transaction.createMany({ data, skipDuplicates: true })
  return NextResponse.json({
    imported: resultado.count,
    skipped: rows.length - resultado.count,
    realizados: rows.filter(r => r.status === 'REALIZADO').length,
    pendentes: rows.filter(r => r.status === 'PENDENTE').length,
  })
}

async function salvarGenerico(corpo: CorpoGenerico) {
  const { transactions, unitId, bankAccountId, overrideMonth, overrideYear } = corpo

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'Nenhum lançamento selecionado' }, { status: 400 })
  }
  if (!unitId) {
    return NextResponse.json({ error: 'Unidade é obrigatória' }, { status: 400 })
  }

  const unit = parseInt(String(unitId))
  const bankAccId = bankAccountId ? parseInt(String(bankAccountId)) : null

  const data = transactions.map(tx => {
    const d = new Date(tx.date)
    return {
      fitid: tx.fitid,
      date: d,
      description: tx.memo,
      memo: tx.memo,
      amount: tx.amount,
      month: overrideMonth || (d.getMonth() + 1),
      year: overrideYear || d.getFullYear(),
      status: 'REALIZADO',
      accountId: tx.accountId ? parseInt(String(tx.accountId)) : null,
      unitId: unit,
      bankAccountId: bankAccId,
    }
  })

  const resultado = await prisma.transaction.createMany({ data, skipDuplicates: true })
  return NextResponse.json({
    imported: resultado.count,
    skipped: transactions.length - resultado.count,
  })
}
