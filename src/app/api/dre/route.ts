import { prisma } from '@/lib/prisma'
import { calcDRE, montarMatrizAnual, CAT } from '@/lib/dre'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/dre?year=2026[&month=7][&unitId=1]
 *
 * Retorna `{ dre, anual, yearData, matriz, rateio }`.
 * Só entra `status = REALIZADO` — a DRE é em regime de caixa.
 *
 * **Rateio da receita por unidade.** Os recebimentos chegam consolidados, sem
 * loja (a planilha do cliente também é assim). Ao filtrar por unidade, custos e
 * despesas são reais e filtrados, e a receita é a receita total do mês
 * multiplicada pela participação da loja — a mesma regra da planilha:
 *   1. participação no faturamento do mês (`UnitSales`, aba Base_Vendas);
 *   2. sem faturamento no mês, participação no CMV real daquele mês;
 *   3. sem os dois, a unidade fica sem receita (é o caso de centros de custo
 *      como o Escritório).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = parseInt(searchParams.get('month') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  const unitParam = searchParams.get('unitId')
  const unitId = unitParam ? parseInt(unitParam) : null

  if (!year) {
    return NextResponse.json({ error: 'year é obrigatório' }, { status: 400 })
  }

  const todas = await prisma.transaction.findMany({
    where: { year, accountId: { not: null }, status: 'REALIZADO' },
    include: { account: true }
  })

  const ehReceita = (t: (typeof todas)[0]) => t.account?.dreGroup === CAT.RECEITA

  let usadas = todas
  let rateio: { metodo: string; participacao: number[] } | null = null

  if (unitId) {
    // Participação da unidade mês a mês
    const vendas = await prisma.unitSales.findMany({ where: { year } })
    const participacao: number[] = []
    let porFaturamento = 0, porCmv = 0

    for (let m = 1; m <= 12; m++) {
      const doMes = vendas.filter(v => v.month === m)
      const totalFat = doMes.reduce((s, v) => s + v.faturamento, 0)
      const daUnidade = doMes.find(v => v.unitId === unitId)?.faturamento ?? 0
      if (totalFat > 0) {
        participacao.push(daUnidade / totalFat)
        if (daUnidade > 0) porFaturamento++
        continue
      }
      // Sem faturamento no mês: usa o CMV real como proxy da participação
      const cmvMes = todas.filter(t => t.month === m && t.account?.dreGroup === CAT.CMV)
      const totalCmv = cmvMes.reduce((s, t) => s + Math.abs(t.amount), 0)
      const cmvUnidade = cmvMes.filter(t => t.unitId === unitId).reduce((s, t) => s + Math.abs(t.amount), 0)
      participacao.push(totalCmv > 0 ? cmvUnidade / totalCmv : 0)
      if (cmvUnidade > 0) porCmv++
    }

    usadas = todas
      .filter(t => (ehReceita(t) && t.unitId === null) || t.unitId === unitId)
      .map(t => (ehReceita(t) && t.unitId === null
        ? { ...t, amount: t.amount * (participacao[t.month - 1] ?? 0) }
        : t))

    rateio = {
      metodo: porFaturamento > 0 && porCmv > 0 ? 'misto'
        : porCmv > 0 ? 'cmv'
          : porFaturamento > 0 ? 'faturamento' : 'sem-base',
      participacao,
    }
  }

  const yearData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return calcDRE(usadas.filter(t => t.month === m) as any, m, year)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anual = calcDRE(usadas as any, 0, year)
  const dre = month > 0 ? yearData[month - 1] : anual
  const matriz = montarMatrizAnual(anual, yearData)

  return NextResponse.json({ dre, anual, yearData, matriz, rateio })
}
