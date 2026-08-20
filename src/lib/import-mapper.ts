/**
 * Conversão de linhas de planilha → lançamentos.
 *
 * Módulo puro (sem dependências) — roda no cliente para dar prévia instantânea
 * quando o usuário troca o mapeamento de colunas, e no servidor na detecção.
 */

export interface ColumnMap {
  date: number
  description: number
  amount: number
  /** -1 quando a planilha não tem coluna de natureza (pagar/receber) */
  type: number
  /** -1 quando não há coluna de valor de crédito separada (layout débito/crédito) */
  credit: number
}

/** Como definir o sinal do valor (entrada +, saída −). */
export type SignMode = 'auto' | 'despesa' | 'receita' | 'arquivo'

export interface MappedTx {
  fitid: string
  date: string          // ISO
  amount: number        // negativo = saída
  memo: string
  row: number           // linha original na planilha (1-based, para mensagens de erro)
}

export interface MapResult {
  transactions: MappedTx[]
  errors: string[]
}

/** "1.234,56" · "1,234.56" · "1234.56" · "R$ 10,00" · "(120,50)" · "1.500,00D" → number (NaN se inválido) */
export function parseNumberBR(s: string): number {
  if (s == null) return NaN
  let clean = String(s).replace(/r\$/i, '').replace(/\s/g, '').trim()
  if (clean === '' || clean === '-') return NaN
  // Contabilidade usa parênteses para negativo
  let neg = false
  if (/^\(.*\)$/.test(clean)) { neg = true; clean = clean.slice(1, -1) }
  // Marcador D/C no fim do valor, comum em extratos ("1.500,00D" = débito)
  const dc = clean.match(/[dc]$/i)
  if (dc) {
    clean = clean.slice(0, -1)
    if (dc[0].toLowerCase() === 'd') neg = true
  }
  if (clean.startsWith('-')) { neg = true; clean = clean.slice(1) }
  if (clean.endsWith('-')) { neg = true; clean = clean.slice(0, -1) }
  // Só dígitos e separadores — rejeita datas ("03/07/2026") e texto solto,
  // que de outra forma o parseFloat truncaria para um número errado.
  if (!/^\d[\d.,]*$/.test(clean)) return NaN
  const lastComma = clean.lastIndexOf(',')
  const lastDot = clean.lastIndexOf('.')
  let normalized: string
  if (lastComma > lastDot) {
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalized = clean.replace(/,/g, '')
  } else {
    normalized = clean.replace(',', '.')
  }
  const v = parseFloat(normalized)
  if (isNaN(v)) return NaN
  return neg ? -v : v
}

/** DD/MM/AAAA · DD-MM-AAAA · AAAA-MM-DD · DD/MM/AA · serial do Excel → Date */
export function parseDateBR(s: string): Date | null {
  const clean = String(s ?? '').trim()
  if (!clean) return null

  // AAAA-MM-DD (ou AAAA/MM/DD)
  let m = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return valid(new Date(+m[1], +m[2] - 1, +m[3]))

  // DD/MM/AAAA (ou DD-MM-AAAA, DD.MM.AAAA)
  m = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (m) return valid(new Date(+m[3], +m[2] - 1, +m[1]))

  // DD/MM/AA
  m = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/)
  if (m) {
    const y = +m[3] + (+m[3] > 50 ? 1900 : 2000)
    return valid(new Date(y, +m[2] - 1, +m[1]))
  }

  // Serial numérico do Excel (dias desde 30/12/1899)
  if (/^\d{5}(\.\d+)?$/.test(clean)) {
    const serial = parseFloat(clean)
    return valid(new Date(Date.UTC(1899, 11, 30) + serial * 86400000))
  }

  return null
}

function valid(d: Date): Date | null {
  return isNaN(d.getTime()) ? null : d
}

// Palavras que identificam saída/entrada numa coluna de natureza ou no nome do arquivo
const OUT_WORDS = ['pag', 'despesa', 'debito', 'débito', 'saida', 'saída', 'pagar', 'custo', 'compra']
const IN_WORDS = ['receb', 'receita', 'credito', 'crédito', 'entrada', 'receber', 'venda']

/** Classifica uma célula de natureza como saída (-1), entrada (+1) ou indefinido (0). */
export function signFromText(text: string): -1 | 0 | 1 {
  const t = (text || '').toLowerCase()
  if (!t) return 0
  if (OUT_WORDS.some(w => t.includes(w))) return -1
  if (IN_WORDS.some(w => t.includes(w))) return 1
  return 0
}

function slugify(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase()
}

/**
 * Aplica o mapeamento de colunas sobre a matriz de dados (sem cabeçalho).
 *
 * signMode:
 *  - `auto`     → usa a coluna de natureza; sem ela, cai no sinal do arquivo
 *  - `despesa`  → tudo negativo (planilha de contas pagas)
 *  - `receita`  → tudo positivo (planilha de contas recebidas)
 *  - `arquivo`  → respeita o sinal escrito na planilha
 */
export function mapRows(
  rows: string[][],
  map: ColumnMap,
  fileName: string,
  signMode: SignMode = 'auto',
  headerOffset = 1
): MapResult {
  const slug = slugify(fileName) || 'imp'
  const transactions: MappedTx[] = []
  const errors: string[] = []
  const seen: Record<string, number> = {}

  rows.forEach((cols, i) => {
    const rowNum = i + headerOffset + 1
    const rawDate = cols[map.date] ?? ''
    const rawDesc = cols[map.description] ?? ''
    const rawAmt = cols[map.amount] ?? ''
    const rawCredit = map.credit >= 0 ? (cols[map.credit] ?? '') : ''

    // Linha totalmente vazia nas colunas relevantes → ignora silenciosamente
    if (!String(rawDate).trim() && !String(rawDesc).trim() && !String(rawAmt).trim() && !String(rawCredit).trim()) return

    const date = parseDateBR(String(rawDate))
    if (!date) {
      errors.push(`Linha ${rowNum}: data inválida "${rawDate}"`)
      return
    }

    let value = parseNumberBR(String(rawAmt))
    let creditSign = 0
    if (map.credit >= 0) {
      const credit = parseNumberBR(String(rawCredit))
      // Layout débito/crédito em colunas separadas: a coluna preenchida define o sinal
      if (!isNaN(credit) && credit !== 0) { value = credit; creditSign = 1 }
      else if (!isNaN(value) && value !== 0) { creditSign = -1 }
    }
    if (isNaN(value) || value === 0) {
      errors.push(`Linha ${rowNum}: valor inválido "${map.credit >= 0 ? `${rawAmt} / ${rawCredit}` : rawAmt}"`)
      return
    }

    const abs = Math.abs(value)
    let sign: -1 | 1
    if (creditSign !== 0) {
      sign = creditSign as -1 | 1
    } else if (signMode === 'despesa') {
      sign = -1
    } else if (signMode === 'receita') {
      sign = 1
    } else if (signMode === 'arquivo') {
      sign = value < 0 ? -1 : 1
    } else {
      // auto: coluna de natureza → nome do arquivo → sinal do próprio valor
      const fromCol = map.type >= 0 ? signFromText(String(cols[map.type] ?? '')) : 0
      const fromFile = signFromText(fileName)
      sign = (fromCol || fromFile || (value < 0 ? -1 : 1)) as -1 | 1
    }

    const memo = String(rawDesc).trim() || 'Sem descrição'
    const dateKey = `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`
    const amtKey = pad(Math.round(abs * 100), 10)
    // Chave estável: mesma linha reimportada é bloqueada; linhas iguais no mesmo
    // arquivo recebem sufixo incremental para não colidirem entre si.
    const baseKey = `sf_${slug}_${dateKey}_${amtKey}`
    seen[baseKey] = (seen[baseKey] || 0) + 1
    const fitid = `${baseKey}_${pad(seen[baseKey], 3)}`

    transactions.push({
      fitid,
      date: date.toISOString(),
      amount: sign * abs,
      memo,
      row: rowNum,
    })
  })

  if (transactions.length === 0 && errors.length === 0) {
    errors.push('Nenhum lançamento válido encontrado na planilha')
  }

  return { transactions, errors }
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}
