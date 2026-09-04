import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readSheetMatrix } from '@/lib/spreadsheet'
import { sniffEstoqueKind, parseEstoque, parseVendasItens, parseDiario } from '@/lib/estoque-import'
import { importarEstoque, importarVendas, importarDiario } from '@/lib/estoque-sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/estoque/import  (multipart: file, unitId, dry?)
 *
 * Reconhece qual dos 3 relatórios do ERP é o arquivo (Estoque, Vendas por item
 * ou Diário) e grava com SUBSTITUIÇÃO por unidade — reimportar nunca duplica.
 * `dry=1` só devolve o resumo, sem gravar (prévia da tela).
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const unitId = parseInt(String(formData.get('unitId') ?? ''))
    const dry = String(formData.get('dry') ?? '') === '1'

    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
    if (!unitId) return NextResponse.json({ error: 'Selecione a loja do relatório' }, { status: 400 })

    const unit = await prisma.unit.findUnique({ where: { id: unitId } })
    if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

    // raw: código de barras numérico não pode virar notação científica
    const matrix = readSheetMatrix(await file.arrayBuffer(), file.name, true)
    if (matrix.length === 0) return NextResponse.json({ error: 'Planilha vazia' }, { status: 422 })

    const kind = sniffEstoqueKind(matrix)
    if (kind === 'desconhecido') {
      return NextResponse.json({
        error: 'Arquivo não reconhecido — esperado um dos relatórios do ERP: Estoque, Vendas por item ou Diário de vendas',
      }, { status: 422 })
    }

    if (kind === 'estoque') {
      const { rows, errors } = parseEstoque(matrix)
      if (rows.length === 0) return NextResponse.json({ error: errors[0] }, { status: 422 })
      const resumo = {
        skus: rows.length,
        unidadesEmEstoque: rows.reduce((s, r) => s + r.qty, 0),
        valorEstoqueCusto: rows.reduce((s, r) => s + r.qty * r.cost, 0),
      }
      if (dry) return NextResponse.json({ kind, unidade: unit.name, resumo, errors: errors.slice(0, 10) })
      const gravados = await importarEstoque(unitId, rows, file.name)
      return NextResponse.json({ kind, unidade: unit.name, gravados, resumo })
    }

    if (kind === 'vendas') {
      const { rows, errors } = parseVendasItens(matrix)
      if (rows.length === 0) return NextResponse.json({ error: errors[0] }, { status: 422 })
      const resumo = {
        skus: rows.length,
        itensVendidos: rows.reduce((s, r) => s + r.qty, 0),
        faturamento: rows.reduce((s, r) => s + r.revenue, 0),
      }
      if (dry) return NextResponse.json({ kind, unidade: unit.name, resumo, errors: errors.slice(0, 10) })
      const gravados = await importarVendas(unitId, rows, file.name)
      return NextResponse.json({ kind, unidade: unit.name, gravados, resumo })
    }

    // diário
    const { rows, errors } = parseDiario(matrix)
    if (rows.length === 0) return NextResponse.json({ error: errors[0] }, { status: 422 })
    const dias = Array.from(new Set(rows.map(r => r.dateISO))).sort()
    const resumo = {
      linhas: rows.length,
      dias: dias.length,
      de: dias[0],
      ate: dias[dias.length - 1],
      itensVendidos: rows.reduce((s, r) => s + r.qty, 0),
    }
    if (dry) return NextResponse.json({ kind, unidade: unit.name, resumo, errors: errors.slice(0, 10) })
    const gravados = await importarDiario(unitId, rows, file.name)
    return NextResponse.json({ kind, unidade: unit.name, gravados, resumo })
  } catch (err) {
    console.error('/api/estoque/import error:', err)
    return NextResponse.json({ error: 'Não foi possível processar o relatório' }, { status: 500 })
  }
}
