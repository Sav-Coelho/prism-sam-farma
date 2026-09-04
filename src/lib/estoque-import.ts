/**
 * Leitura dos 3 relatórios de estoque/vendas que o ERP exporta por loja —
 * os mesmos que o cliente colava na planilha "BRAVE · Painel — Sam Farma":
 *
 * 1. **Estoque**  — Cód.Barras · Embalagem · Curva ABC · Classificação 2º Nível ·
 *                   Estoque · Preço Oferta · Custo Unit. · Lucro Unit.
 * 2. **Vendas por item** (período) — Cód.Barras · Embalagem · Curva ABC · Itens ·
 *                   Preço Venda · Custo Unit. · Estoque · Venda (R$)
 * 3. **Diário de vendas** — Data · Cód.Barras · Embalagem · ... · Itens · ... · Venda
 *
 * Módulo puro (sem banco): o /api/estoque/import e o backfill usam estas funções.
 */
import { parseDateBR, parseNumberBR } from './import-mapper'
import { findCol } from './spreadsheet'

export type EstoqueFileKind = 'estoque' | 'vendas' | 'diario' | 'desconhecido'

export interface EstoqueRow {
  barcode: string
  name: string
  abc: string
  category: string   // 2º nível ("PRINCIPAL_2 > NAO MEDICAMENTO" → "Nao Medicamento")
  qty: number
  price: number
  cost: number
}

export interface VendaItemRow {
  barcode: string
  name: string
  abc: string
  qty: number
  revenue: number
  cost: number       // custo unit. do próprio relatório (fallback do motor)
}

export interface DiarioRow {
  dateISO: string    // AAAA-MM-DD
  barcode: string
  name: string
  qty: number
  revenue: number
}

/** "0006" → "6" (o ERP ora exporta com zeros à esquerda, ora sem).
 *  Acima de 15 dígitos não normaliza — parseInt perderia precisão. */
export function normalizarBarcode(s: string): string {
  const limpo = String(s ?? '').trim()
  if (/^\d+$/.test(limpo) && limpo.length <= 15) return String(parseInt(limpo, 10))
  return limpo
}

function properCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())
}

/** "PRINCIPAL_2 > NAO MEDICAMENTO" → "Nao Medicamento" (igual à planilha: após o 1º ">"). */
export function categoria2Nivel(raw: string): string {
  const limpo = String(raw ?? '').trim()
  if (!limpo) return 'Não Classificado'
  const i = limpo.indexOf('>')
  return properCase((i >= 0 ? limpo.slice(i + 1) : limpo).trim()) || 'Não Classificado'
}

/** Identifica qual dos 3 relatórios é o arquivo, pelo cabeçalho. */
export function sniffEstoqueKind(matrix: string[][]): EstoqueFileKind {
  const head = matrix.slice(0, 15).map(r => r.join(' | ').toLowerCase()).join('\n')
  const temBarras = /c[óo]d\.?\s*(de\s*)?barras/.test(head)
  if (!temBarras) return 'desconhecido'
  if (/\bdata\b/.test(head) && /itens/.test(head)) return 'diario'
  if (/pre[çc]o\s*oferta/.test(head) || /lucro\s*unit/.test(head)) return 'estoque'
  if (/itens/.test(head) && /venda/.test(head)) return 'vendas'
  return 'desconhecido'
}

function acharCabecalho(matrix: string[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    if (matrix[r].some(c => /c[óo]d\.?\s*(de\s*)?barras/i.test(c))) return r
  }
  return 0
}

const linhaTotal = (nome: string) => /^total/i.test(nome.trim())

const COLS = {
  barcode:  ['cód.barras', 'cod.barras', 'código de barras', 'codigo de barras', 'cód. barras', 'barras', 'ean'],
  name:     ['embalagem', 'produto', 'descrição', 'descricao'],
  abc:      ['curva abc', 'curva', 'abc'],
  category: ['classificação 2º nível', 'classificacao 2º nivel', 'classificação 2° nível', 'classificação', 'classificacao', 'categoria'],
  qtyEst:   ['estoque'],
  price:    ['preço oferta', 'preco oferta', 'preço venda', 'preco venda', 'preço', 'preco'],
  cost:     ['custo unit.', 'custo unit', 'custo unitário', 'custo unitario', 'custo'],
  itens:    ['itens', 'qtde', 'quantidade'],
  venda:    ['venda'],
  data:     ['data'],
}

export function parseEstoque(matrix: string[][]): { rows: EstoqueRow[]; errors: string[] } {
  const hdr = acharCabecalho(matrix)
  const h = matrix[hdr]
  const col = {
    barcode: findCol(h, COLS.barcode),
    name: findCol(h, COLS.name),
    abc: findCol(h, COLS.abc),
    category: findCol(h, COLS.category),
    qty: findCol(h, COLS.qtyEst),
    price: findCol(h, COLS.price),
    cost: findCol(h, COLS.cost),
  }
  const errors: string[] = []
  if (col.barcode < 0 || col.qty < 0) {
    return { rows: [], errors: ['Cabeçalho não reconhecido: preciso de Cód.Barras e Estoque'] }
  }

  const rows: EstoqueRow[] = []
  const vistos: Record<string, boolean> = {}
  for (let r = hdr + 1; r < matrix.length; r++) {
    const linha = matrix[r]
    const barcode = normalizarBarcode(String(linha[col.barcode] ?? ''))
    const name = String(linha[col.name] ?? '').trim()
    if (!barcode || linhaTotal(name) || linhaTotal(barcode)) continue
    // primeira ocorrência vence — mesma regra do MATCH da planilha
    if (vistos[barcode]) continue
    vistos[barcode] = true
    const qty = parseNumberBR(String(linha[col.qty] ?? ''))
    const price = col.price >= 0 ? parseNumberBR(String(linha[col.price] ?? '')) : NaN
    const cost = col.cost >= 0 ? parseNumberBR(String(linha[col.cost] ?? '')) : NaN
    rows.push({
      barcode,
      name: name || barcode,
      abc: col.abc >= 0 ? String(linha[col.abc] ?? '').trim() : '',
      category: categoria2Nivel(col.category >= 0 ? String(linha[col.category] ?? '') : ''),
      qty: isNaN(qty) ? 0 : qty,
      price: isNaN(price) ? 0 : price,
      cost: isNaN(cost) ? 0 : cost,
    })
  }
  if (rows.length === 0) errors.push('Nenhum produto reconhecido no relatório de estoque')
  return { rows, errors }
}

export function parseVendasItens(matrix: string[][]): { rows: VendaItemRow[]; errors: string[] } {
  const hdr = acharCabecalho(matrix)
  const h = matrix[hdr]
  const usado = new Set<number>()
  const pega = (nomes: string[]) => { const i = findCol(h, nomes, usado); if (i >= 0) usado.add(i); return i }
  const col = {
    barcode: pega(COLS.barcode),
    abc: pega(COLS.abc),
    qty: pega(COLS.itens),
    venda: pega(COLS.venda),
    cost: pega(COLS.cost),
    name: pega(COLS.name),
  }
  if (col.barcode < 0 || col.qty < 0 || col.venda < 0) {
    return { rows: [], errors: ['Cabeçalho não reconhecido: preciso de Cód.Barras, Itens e Venda'] }
  }

  const porBarcode: Record<string, VendaItemRow> = {}
  const ordem: string[] = []
  for (let r = hdr + 1; r < matrix.length; r++) {
    const linha = matrix[r]
    const barcode = normalizarBarcode(String(linha[col.barcode] ?? ''))
    const name = col.name >= 0 ? String(linha[col.name] ?? '').trim() : ''
    if (!barcode || linhaTotal(name) || linhaTotal(barcode)) continue
    const qty = parseNumberBR(String(linha[col.qty] ?? ''))
    const revenue = parseNumberBR(String(linha[col.venda] ?? '').replace(/^R+\$?/i, ''))
    if (isNaN(qty) && isNaN(revenue)) continue
    const cost = col.cost >= 0 ? parseNumberBR(String(linha[col.cost] ?? '')) : NaN
    const atual = porBarcode[barcode]
    if (atual) {
      // mesmo produto em duas linhas do relatório → soma
      atual.qty += isNaN(qty) ? 0 : qty
      atual.revenue += isNaN(revenue) ? 0 : revenue
      if (atual.cost === 0 && !isNaN(cost)) atual.cost = cost
    } else {
      porBarcode[barcode] = {
        barcode,
        name: name || barcode,
        abc: col.abc >= 0 ? String(linha[col.abc] ?? '').trim() : '',
        qty: isNaN(qty) ? 0 : qty,
        revenue: isNaN(revenue) ? 0 : revenue,
        cost: isNaN(cost) ? 0 : cost,
      }
      ordem.push(barcode)
    }
  }
  const rows = ordem.map(b => porBarcode[b])
  return { rows, errors: rows.length === 0 ? ['Nenhuma venda reconhecida no relatório'] : [] }
}

export function parseDiario(matrix: string[][]): { rows: DiarioRow[]; errors: string[] } {
  const hdr = acharCabecalho(matrix)
  const h = matrix[hdr]
  const usado = new Set<number>()
  const pega = (nomes: string[]) => { const i = findCol(h, nomes, usado); if (i >= 0) usado.add(i); return i }
  const col = {
    data: pega(COLS.data),
    barcode: pega(COLS.barcode),
    qty: pega(COLS.itens),
    venda: pega(COLS.venda),
    name: pega(COLS.name),
  }
  if (col.data < 0 || col.barcode < 0 || col.qty < 0) {
    return { rows: [], errors: ['Cabeçalho não reconhecido: preciso de Data, Cód.Barras e Itens'] }
  }

  const porChave: Record<string, DiarioRow> = {}
  const ordem: string[] = []
  const errors: string[] = []
  for (let r = hdr + 1; r < matrix.length; r++) {
    const linha = matrix[r]
    const barcode = normalizarBarcode(String(linha[col.barcode] ?? ''))
    if (!barcode) continue
    const data = parseDateBR(String(linha[col.data] ?? ''))
    if (!data) { if (String(linha[col.data] ?? '').trim()) errors.push('Linha ' + (r + 1) + ': data inválida'); continue }
    const qty = parseNumberBR(String(linha[col.qty] ?? ''))
    if (isNaN(qty) || qty === 0) continue
    const revenue = col.venda >= 0 ? parseNumberBR(String(linha[col.venda] ?? '').replace(/^R+\$?/i, '')) : NaN
    const dateISO = data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0')
    const chave = dateISO + '|' + barcode
    const atual = porChave[chave]
    if (atual) {
      atual.qty += qty
      atual.revenue += isNaN(revenue) ? 0 : revenue
    } else {
      porChave[chave] = {
        dateISO,
        barcode,
        name: (col.name >= 0 ? String(linha[col.name] ?? '').trim() : '') || barcode,
        qty,
        revenue: isNaN(revenue) ? 0 : revenue,
      }
      ordem.push(chave)
    }
  }
  const rows = ordem.map(k => porChave[k])
  return { rows, errors: rows.length === 0 ? ['Nenhuma venda diária reconhecida'].concat(errors.slice(0, 5)) : errors.slice(0, 20) }
}
