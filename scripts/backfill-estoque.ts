/**
 * Carga inicial do módulo Estoque & Compras a partir da planilha da Brave
 * ("BRAVE · Painel — Sam Farma") — usa os relatórios do ERP que o cliente
 * colou nas abas 1–6.
 *
 * Uma aba por execução (a máquina tem pouca RAM e o arquivo é grande):
 *   node .backfill-out/scripts/backfill-estoque.js "<planilha.xlsx>" "1 Estoque IGA" IGARASSU
 *
 * Reexecutar é seguro: a gravação substitui o snapshot da unidade.
 */
import * as XLSX from 'xlsx'
import { prisma } from '../src/lib/prisma'
import { parseDiario, parseEstoque, parseVendasItens, sniffEstoqueKind } from '../src/lib/estoque-import'
import { importarDiario, importarEstoque, importarVendas } from '../src/lib/estoque-sync'

async function main() {
  const caminho = process.argv[2]
  const aba = process.argv[3]
  const unidadeNome = (process.argv[4] || '').toUpperCase()
  if (!caminho || !aba || !unidadeNome) {
    console.error('Uso: backfill-estoque <planilha.xlsx> <aba> <unidade>')
    process.exit(1)
  }

  const unidade = await prisma.unit.findFirst({ where: { name: unidadeNome } })
  if (!unidade) { console.error('Unidade não encontrada: ' + unidadeNome); process.exit(1) }

  const wb = XLSX.readFile(caminho, { cellDates: false, cellFormula: false, cellStyles: false, sheets: [aba] })
  const sheet = wb.Sheets[aba]
  if (!sheet) { console.error('Aba não encontrada: ' + aba); process.exit(1) }
  // raw: true — código de barras numérico não pode virar notação científica
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '', raw: true })
    .map(l => (l as unknown[]).map(c => String(c ?? '').trim()))

  const kind = sniffEstoqueKind(matrix)
  console.log(aba + ' → ' + unidadeNome + ' · tipo: ' + kind + ' · ' + matrix.length + ' linhas na aba')

  if (kind === 'estoque') {
    const { rows, errors } = parseEstoque(matrix)
    if (rows.length === 0) { console.log('  nada a importar (' + errors.join('; ') + ')'); return }
    const n = await importarEstoque(unidade.id, rows, aba)
    console.log('  ' + n + ' posições de estoque gravadas (snapshot substituído)')
  } else if (kind === 'vendas') {
    const { rows, errors } = parseVendasItens(matrix)
    if (rows.length === 0) { console.log('  nada a importar (' + errors.join('; ') + ')'); return }
    const n = await importarVendas(unidade.id, rows, aba)
    console.log('  ' + n + ' itens de venda gravados (snapshot substituído)')
  } else if (kind === 'diario') {
    const { rows } = parseDiario(matrix)
    if (rows.length === 0) { console.log('  diário sem dados — pulado'); return }
    const n = await importarDiario(unidade.id, rows, aba)
    console.log('  ' + n + ' linhas de diário gravadas')
  } else {
    console.log('  tipo não reconhecido — pulado')
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
