/**
 * Leitura de planilha (xlsx/xls/csv) → matriz de strings, com detecção
 * tolerante da linha de cabeçalho e das colunas por sinônimos.
 * Usado somente no servidor (importa `xlsx`).
 */
import * as XLSX from 'xlsx'
import { parseDateBR, parseNumberBR, type ColumnMap } from './import-mapper'

function detectDelimiter(line: string): string {
  const semi = (line.match(/;/g) || []).length
  const comma = (line.match(/,/g) || []).length
  const tab = (line.match(/\t/g) || []).length
  if (semi >= comma && semi >= tab) return ';'
  if (tab >= comma) return '\t'
  return ','
}

/** Lê a primeira aba (ou o CSV) e devolve uma matriz de strings já aparadas. */
export function readSheetMatrix(buffer: ArrayBuffer, fileName: string): string[][] {
  if (fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.txt')) {
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')
    const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0)
    const delim = detectDelimiter(rows[0] || '')
    return rows.map(l => l.split(delim).map(c => c.replace(/^["']|["']$/g, '').trim()))
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
  return data.map(row => (row as unknown[]).map(c => String(c ?? '').trim()))
}

/**
 * Índice da coluna cujo cabeçalho casa (exato, depois parcial) com algum sinônimo.
 * `exclude` protege colunas já atribuídas a outro campo — sem isso um cabeçalho como
 * "Data Recebimento" é capturado tanto por `date` quanto por `credit`.
 */
export function findCol(headers: string[], names: string[], exclude?: Set<number>): number {
  const lower = headers.map(h => h.toLowerCase().trim())
  const free = (i: number) => i >= 0 && !exclude?.has(i)
  for (const n of names) {
    const i = lower.indexOf(n)
    if (free(i)) return i
  }
  for (const n of names) {
    const i = lower.findIndex((h, idx) => !exclude?.has(idx) && h.includes(n))
    if (free(i)) return i
  }
  return -1
}

/** Sinônimos aceitos nos cabeçalhos de planilhas de contas pagas / recebidas. */
export const COL_SYNONYMS = {
  date: [
    'data de pagamento', 'data pagamento', 'data do pagamento', 'data de recebimento',
    'data recebimento', 'data de baixa', 'data baixa', 'data de quitação', 'data liquidação',
    'data de vencimento', 'data vencimento', 'vencimento', 'data lançamento',
    'data do lançamento', 'competência', 'competencia', 'data', 'date', 'dt', 'emissão', 'emissao',
  ],
  description: [
    'histórico', 'historico', 'descrição', 'descricao', 'descrição do lançamento',
    'fornecedor', 'cliente', 'favorecido', 'beneficiário', 'beneficiario', 'razão social',
    'razao social', 'nome', 'título', 'titulo', 'documento', 'observação', 'observacao',
    'memo', 'lançamento', 'lancamento', 'description',
  ],
  amount: [
    'valor pago', 'valor recebido', 'valor baixado', 'valor líquido', 'valor liquido',
    'valor do título', 'valor titulo', 'valor (r$)', 'valor r$', 'vlr', 'valor', 'debito',
    'débito', 'total', 'amount', 'montante',
  ],
  credit: ['crédito', 'credito', 'valor crédito', 'valor credito', 'entrada', 'recebimento'],
  type: [
    'natureza', 'tipo', 'tipo de lançamento', 'tipo lançamento', 'operação', 'operacao',
    'espécie', 'especie', 'd/c', 'dc', 'categoria', 'movimento',
  ],
}

/**
 * Mapeia um cabeçalho para as colunas do import. Cada coluna é atribuída a um
 * único campo: a ordem vai do sinônimo mais específico (data, valor) para o mais
 * genérico (descrição casa com "nome", "documento", "observação"...).
 */
function mapHeaders(headers: string[]): ColumnMap {
  const used = new Set<number>()
  const pick = (names: string[]): number => {
    const i = findCol(headers, names, used)
    if (i >= 0) used.add(i)
    return i
  }
  const map: ColumnMap = {
    date: pick(COL_SYNONYMS.date),
    amount: pick(COL_SYNONYMS.amount),
    credit: pick(COL_SYNONYMS.credit),
    type: pick(COL_SYNONYMS.type),
    description: pick(COL_SYNONYMS.description),
  }
  // Planilha só de recebimentos: o que foi achado como "crédito" é o valor
  if (map.amount < 0 && map.credit >= 0) {
    map.amount = map.credit
    map.credit = -1
  }
  return map
}

export interface DetectResult {
  /** índice (0-based) da linha usada como cabeçalho */
  headerRow: number
  headers: string[]
  rows: string[][]
  map: ColumnMap
  missing: string[]
}

/**
 * Acha a linha de cabeçalho (primeira linha, nas 15 iniciais, que casa com data
 * + valor) e mapeia as colunas. Planilhas de ERP costumam ter título/filtros
 * acima do cabeçalho real.
 */
export function detectLayout(matrix: string[][]): DetectResult {
  let bestRow = 0
  let bestScore = -1
  let bestMap: ColumnMap = { date: -1, description: -1, amount: -1, type: -1, credit: -1 }

  const limit = Math.min(matrix.length, 15)
  for (let r = 0; r < limit; r++) {
    const headers = matrix[r]
    if (headers.filter(h => h !== '').length < 2) continue
    const map = mapHeaders(headers)
    const score =
      (map.date >= 0 ? 2 : 0) +
      (map.amount >= 0 ? 2 : 0) +
      (map.description >= 0 ? 1 : 0) +
      (map.type >= 0 ? 1 : 0)
    if (score > bestScore) { bestScore = score; bestRow = r; bestMap = map }
    if (score === 6) break
  }

  let headers = matrix[bestRow] ?? []
  let rows = matrix.slice(bestRow + 1)

  // Nenhum cabeçalho reconhecível → tenta inferir pelo conteúdo da primeira linha de dados
  if (bestMap.date < 0 || bestMap.amount < 0) {
    const inferred = inferByContent(matrix)
    if (inferred) {
      bestMap = inferred.map
      headers = inferred.headers
      rows = inferred.rows
      bestRow = inferred.headerRow
    }
  }

  const missing: string[] = []
  if (bestMap.date < 0) missing.push('data')
  if (bestMap.amount < 0) missing.push('valor')
  if (bestMap.description < 0) missing.push('descrição')

  return { headerRow: bestRow, headers, rows, map: bestMap, missing }
}

/** Planilha sem cabeçalho: usa a 1ª linha com data + número para achar as colunas. */
function inferByContent(matrix: string[][]): (DetectResult & { headerRow: number }) | null {
  for (let r = 0; r < Math.min(matrix.length, 20); r++) {
    const cols = matrix[r]
    const dateIdx = cols.findIndex(c => parseDateBR(c) !== null)
    if (dateIdx < 0) continue
    const amtIdx = cols.findIndex((c, i) => i !== dateIdx && !isNaN(parseNumberBR(c)) && /[\d]/.test(c))
    if (amtIdx < 0) continue
    const descIdx = cols.findIndex((c, i) => i !== dateIdx && i !== amtIdx && c.length > 2 && isNaN(parseNumberBR(c)))
    return {
      headerRow: r > 0 ? r - 1 : 0,
      headers: cols.map((_, i) => `Coluna ${i + 1}`),
      rows: matrix.slice(r),
      map: { date: dateIdx, description: descIdx, amount: amtIdx, type: -1, credit: -1 },
      missing: [],
    }
  }
  return null
}
