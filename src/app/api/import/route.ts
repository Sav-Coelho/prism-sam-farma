import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

interface IncomingTx {
  fitid: string
  date: string
  amount: number
  memo: string
  accountId?: string | number | null
  transferToUnitId?: string | number | null
  transferToBankAccountId?: string | number | null
}

interface SaveBody {
  transactions: IncomingTx[]
  unitId?: string | number | null
  bankAccountId?: string | number | null
  /** Quando presentes, forçam a competência de todo o lote (ex.: fechamento do mês) */
  overrideMonth?: number | null
  overrideYear?: number | null
}

/**
 * POST /api/import — grava o lote da prévia.
 * `fitid` é único: reimportar o mesmo arquivo não duplica (skipDuplicates).
 * Lançamentos classificados como transferência ganham a contrapartida de entrada.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as SaveBody
  const { transactions, unitId, bankAccountId, overrideMonth, overrideYear } = body

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
      accountId: tx.accountId ? parseInt(String(tx.accountId)) : null,
      unitId: unit,
      bankAccountId: bankAccId,
      transferToUnitId: tx.transferToUnitId ? parseInt(String(tx.transferToUnitId)) : null,
      transferToBankAccountId: tx.transferToBankAccountId ? parseInt(String(tx.transferToBankAccountId)) : null,
    }
  })

  const result = await prisma.transaction.createMany({ data, skipDuplicates: true })
  const imported = result.count
  const skipped = transactions.length - imported

  // Contrapartida de entrada das transferências entre contas próprias
  const transferTxs = transactions.filter(tx => tx.transferToBankAccountId && tx.accountId)
  if (transferTxs.length > 0) {
    const counterparts = transferTxs.map(tx => {
      const d = new Date(tx.date)
      return {
        fitid: tx.fitid + '_entrada',
        date: d,
        description: 'Entrada de Transferência - ' + tx.memo,
        memo: 'Entrada de Transferência - ' + tx.memo,
        amount: Math.abs(tx.amount),
        month: overrideMonth || (d.getMonth() + 1),
        year: overrideYear || d.getFullYear(),
        accountId: parseInt(String(tx.accountId)),
        unitId: tx.transferToUnitId ? parseInt(String(tx.transferToUnitId)) : unit,
        bankAccountId: parseInt(String(tx.transferToBankAccountId)),
      }
    })
    await prisma.transaction.createMany({ data: counterparts, skipDuplicates: true })
  }

  return NextResponse.json({ imported, skipped })
}
