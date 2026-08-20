import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, detectLayout } from '@/lib/spreadsheet'

export const runtime = 'nodejs'

const MAX_ROWS = 5000

/**
 * POST /api/import/parse  (multipart: file)
 *
 * Lê a planilha de contas pagas / recebidas e devolve a matriz bruta + o
 * mapeamento de colunas detectado. A conversão em lançamentos acontece no
 * cliente (src/lib/import-mapper.ts) para que o usuário possa corrigir o
 * mapeamento e ver a prévia mudar na hora.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['xlsx', 'xls', 'xlsm', 'csv', 'txt'].includes(ext)) {
      return NextResponse.json(
        { error: 'Formato não suportado. Envie .xlsx, .xls ou .csv' },
        { status: 400 }
      )
    }

    const buffer = await file.arrayBuffer()
    const matrix = readSheetMatrix(buffer, file.name)

    if (matrix.length === 0) {
      return NextResponse.json({ error: 'Planilha vazia' }, { status: 422 })
    }

    const layout = detectLayout(matrix)

    return NextResponse.json({
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
