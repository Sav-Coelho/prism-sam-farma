/**
 * Carrega um arquivo mensal de recebíveis pelo MESMO caminho da tela:
 * reconhecimento (`sniffKind`) → parse → gravação com substituição do mês.
 *
 * Uso: node .backfill-out/scripts/carregar-recebiveis.js "<arquivo.xlsx>" [maxRows]
 * (`maxRows` menor ajuda em máquina com pouca RAM; o dado fica nas primeiras linhas)
 */
import * as fs from 'fs'
import { prisma } from '../src/lib/prisma'
import { readSheetMatrix } from '../src/lib/spreadsheet'
import { parseRecebimentos, sniffKind } from '../src/lib/erp-import'
import { gravarRecebimentos } from '../src/lib/erp-sync'

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const pad = (n: number) => String(n).padStart(2, '0')

async function main() {
  const caminho = process.argv[2]
  const maxRows = parseInt(process.argv[3] || '') || 50000
  if (!caminho) { console.error('Uso: carregar-recebiveis <arquivo.xlsx> [maxRows]'); process.exit(1) }

  const buf = fs.readFileSync(caminho)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const nome = caminho.split(/[\/]/).pop() || 'recebiveis.xlsx'
  const matrix = readSheetMatrix(ab, nome, false, maxRows)
  const kind = sniffKind(matrix)
  console.log(nome + ' · tipo reconhecido: ' + kind + ' · ' + matrix.length + ' linhas lidas')
  if (kind !== 'recebimentos') { console.error('Não é um arquivo de recebimentos'); process.exit(1) }

  const r = parseRecebimentos(matrix, nome, new Date().getFullYear())
  console.log(r.rows.length + ' recebimentos agregados · recebido R$ ' + brl(r.totalRealizado) + ' · a receber R$ ' + brl(r.totalPendente))
  r.rows.forEach(x => console.log('  ' + x.year + '-' + pad(x.month) + '  ' + (x.unidade || '(sem unidade)').padEnd(28)
    + x.canal.padEnd(32) + ('R$ ' + brl(x.valor)).padStart(15) + '  ' + x.status))

  const g = await gravarRecebimentos(r.rows, null)
  console.log('\nSubstituídos (apagados): ' + g.apagados + ' · gravados: ' + g.gravados + ' · meses: ' + g.meses.join(', '))
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
