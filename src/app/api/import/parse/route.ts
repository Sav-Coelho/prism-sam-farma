import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, detectLayout } from '@/lib/spreadsheet'
import { sniffKind, parsePagamentos, parseRecebimentos } from '@/lib/erp-import'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const MAX_ROWS = 8000

/**
 * POST /api/import/parse  (multipart: file)
 *
 * Reconhece sozinho os dois arquivos da rotina mensal:
 *  - **Contas a Pagar** (export do ERP) → lançamentos já classificados pela
 *    coluna "Plano de Contas"; devolve quais chaves ainda não existem no De-Para
 *  - **Recebidos e Recebíveis** → receita por canal e mês
 *
 * Qualquer outra planilha cai no fluxo genérico (mapeamento manual de colunas).
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (['xlsx', 'xls', 'xlsm', 'csv', 'txt'].indexOf(ext) < 0) {
      return NextResponse.json({ error: 'Formato não suportado. Envie .xlsx, .xls ou .csv' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const matrix = readSheetMatrix(buffer, file.name)
    if (matrix.length === 0) return NextResponse.json({ error: 'Planilha vazia' }, { status: 422 })

    const kind = sniffKind(matrix)

    if (kind === 'pagamentos') {
      const r = parsePagamentos(matrix, file.name)
      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Nenhum título encontrado na planilha' }, { status: 422 })
      }
      // Quais chaves do ERP já estão no De-Para
      const conhecidas = await prisma.account.findMany({
        where: { erpKey: { in: r.erpKeys } },
        select: { erpKey: true, dreGroup: true, name: true },
      })
      const mapa: Record<string, { dreGroup: string; name: string }> = {}
      conhecidas.forEach(a => { if (a.erpKey) mapa[a.erpKey] = { dreGroup: a.dreGroup, name: a.name } })
      const novas = r.erpKeys.filter(k => !mapa[k])

      return NextResponse.json({
        kind,
        fileName: file.name,
        rows: r.rows.slice(0, MAX_ROWS),
        truncated: r.rows.length > MAX_ROWS,
        errors: r.errors.slice(0, 50),
        totalRealizado: r.totalRealizado,
        totalPendente: r.totalPendente,
        mapa,
        chavesNovas: novas,
      })
    }

    if (kind === 'recebimentos') {
      const anoPadrao = parseInt(String(formData.get('ano') ?? '')) || new Date().getFullYear()
      const r = parseRecebimentos(matrix, file.name, anoPadrao)
      if (r.rows.length === 0) {
        return NextResponse.json({ error: r.errors[0] || 'Nenhum recebimento encontrado' }, { status: 422 })
      }
      return NextResponse.json({
        kind,
        fileName: file.name,
        rows: r.rows,
        errors: r.errors.slice(0, 50),
        totalRealizado: r.totalRealizado,
        totalPendente: r.totalPendente,
      })
    }

    // Planilha desconhecida — mapeamento manual de colunas
    const layout = detectLayout(matrix)
    return NextResponse.json({
      kind: 'generico',
      fileName: file.name,
      headers: layout.headers,
      headerRow: layout.headerRow,
      rows: layout.rows.slice(0, MAX_ROWS),
      truncated: layout.rows.length > MAX_ROWS,
      map: layout.map,
      missing: layout.missing,
    })
  } catch (err) {
    console.error('/api/import/parse error:', err)
    return NextResponse.json({ error: 'Não foi possível ler a planilha' }, { status: 500 })
  }
}
