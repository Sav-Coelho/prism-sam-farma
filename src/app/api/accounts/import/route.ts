import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, findCol } from '@/lib/spreadsheet'
import { DRE_GROUPS, TRANSFER_GROUP } from '@/lib/dre'

export const runtime = 'nodejs'

interface SectionInfo { type: string; dreGroup: string }

/** Cabeçalhos de seção aceitos (formato "modelo de DRE" em coluna única). */
const SECTION_MAP: Record<string, SectionInfo> = {
  'receita operacional':                  { type: 'RECEITA',  dreGroup: 'Receita Operacional' },
  'receitas operacionais':               { type: 'RECEITA',  dreGroup: 'Receita Operacional' },
  'deduções sobre a venda':              { type: 'DEDUCAO',  dreGroup: 'Deduções sobre a Venda' },
  'deducoes sobre a venda':              { type: 'DEDUCAO',  dreGroup: 'Deduções sobre a Venda' },
  'deduções sobre vendas':               { type: 'DEDUCAO',  dreGroup: 'Deduções sobre a Venda' },
  'custo do produto/serviço':            { type: 'CUSTO',    dreGroup: 'Custo do Produto/Serviço' },
  'custo do produto/servico':            { type: 'CUSTO',    dreGroup: 'Custo do Produto/Serviço' },
  'cmv':                                 { type: 'CUSTO',    dreGroup: 'Custo do Produto/Serviço' },
  'despesa variável':                    { type: 'CUSTO',    dreGroup: 'Despesa Variável' },
  'despesa variavel':                    { type: 'CUSTO',    dreGroup: 'Despesa Variável' },
  'despesas variáveis':                  { type: 'CUSTO',    dreGroup: 'Despesa Variável' },
  'despesas administrativas':            { type: 'DESPESA',  dreGroup: 'Despesas Administrativas' },
  'despesas financeiras':                { type: 'DESPESA',  dreGroup: 'Despesas Financeiras' },
  'despesas com pessoal':                { type: 'DESPESA',  dreGroup: 'Despesas com Pessoal' },
  'despesas com marketing':              { type: 'DESPESA',  dreGroup: 'Despesas com Marketing' },
  'despesas comerciais':                 { type: 'DESPESA',  dreGroup: 'Despesas Comerciais' },
  'investimentos':                       { type: 'DESPESA',  dreGroup: 'Investimentos' },
  'investimento em desenv. empresarial': { type: 'DESPESA',  dreGroup: 'Investimentos' },
  'receita não operacional':             { type: 'RECEITA',  dreGroup: 'Receita Não Operacional' },
  'receita nao operacional':             { type: 'RECEITA',  dreGroup: 'Receita Não Operacional' },
  'despesas não operacionais':           { type: 'DESPESA',  dreGroup: 'Despesas Não Operacionais' },
  'despesas nao operacionais':           { type: 'DESPESA',  dreGroup: 'Despesas Não Operacionais' },
  'impostos':                            { type: 'IMPOSTO',  dreGroup: 'Impostos' },
  'transferência entre contas':          { type: 'NEUTRO',   dreGroup: TRANSFER_GROUP },
}

/** Prefixo de código gerado automaticamente por grupo. */
const GROUP_PREFIX: Record<string, string> = {
  'Receita Operacional':       '3.1',
  'Deduções sobre a Venda':    '3.2',
  'Custo do Produto/Serviço':  '4.1',
  'Despesa Variável':          '4.2',
  'Despesas Administrativas':  '5.1',
  'Despesas Financeiras':      '5.2',
  'Despesas com Pessoal':      '5.3',
  'Despesas com Marketing':    '5.4',
  'Despesas Comerciais':       '5.5',
  'Investimentos':             '6.1',
  'Receita Não Operacional':   '7.1',
  'Despesas Não Operacionais': '7.2',
  'Impostos':                  '8.1',
  [TRANSFER_GROUP]:            '9.9',
}

/** Linhas de totalização / estrutura — não são contas. */
const SKIP_PATTERNS = [/^\(=\)/, /^\(-\)/, /^\(\+\/-\)/, /^dre\b/i, /^categoria de vis/i, /^total/i]

const ALL_GROUPS: string[] = Object.keys(DRE_GROUPS).reduce<string[]>(
  (acc, t) => acc.concat(DRE_GROUPS[t]), []
)

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function shouldSkip(name: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(name.trim()))
}

/** Resolve o grupo escrito na planilha para um `dreGroup` válido. */
function resolveGroup(raw: string): SectionInfo | null {
  const n = norm(raw)
  if (SECTION_MAP[n]) return SECTION_MAP[n]
  const exact = ALL_GROUPS.find(g => norm(g) === n)
  if (exact) {
    const type = Object.keys(DRE_GROUPS).find(t => DRE_GROUPS[t].includes(exact))!
    return { type, dreGroup: exact }
  }
  return null
}

async function nextCode(dreGroup: string, used: Set<string>): Promise<string> {
  const prefix = GROUP_PREFIX[dreGroup] || '9.9'
  const existing = await prisma.account.findMany({
    where: { code: { startsWith: prefix + '.' } },
    select: { code: true },
  })
  const nums = existing
    .map(a => parseInt(a.code.split('.').pop() || '0') || 0)
    .concat(Array.from(used)
      .filter(c => c.startsWith(prefix + '.'))
      .map(c => parseInt(c.split('.').pop() || '0') || 0))
  const next = (nums.length > 0 ? Math.max.apply(null, nums) : 0) + 1
  const code = `${prefix}.${String(next).padStart(2, '0')}`
  used.add(code)
  return code
}

/**
 * POST /api/accounts/import  (multipart: file)
 *
 * Aceita dois formatos:
 *  1. Tabular — colunas Código / Nome / Tipo / Grupo DRE (ordem livre)
 *  2. Coluna única — cabeçalhos de seção ("Despesas Administrativas") seguidos
 *     das contas daquele grupo; código gerado automaticamente
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  const matrix = readSheetMatrix(buffer, file.name)
  if (matrix.length === 0) return NextResponse.json({ error: 'Planilha vazia' }, { status: 422 })

  // Procura um cabeçalho tabular nas 10 primeiras linhas
  let headerRow = -1
  let cols = { code: -1, name: -1, type: -1, group: -1 }
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const h = matrix[r]
    const c = {
      code: findCol(h, ['código', 'codigo', 'cod', 'conta']),
      name: findCol(h, ['nome da conta', 'nome', 'descrição', 'descricao', 'conta contábil']),
      type: findCol(h, ['tipo', 'natureza']),
      group: findCol(h, ['grupo dre', 'grupo na dre', 'grupo', 'dregroup', 'classificação', 'classificacao']),
    }
    if (c.name >= 0 && c.group >= 0) { headerRow = r; cols = c; break }
  }

  const stats = { imported: 0, updated: 0, errors: [] as string[] }
  const usedCodes = new Set<string>()

  if (headerRow >= 0) {
    // ── Formato tabular ────────────────────────────────────────────────
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r]
      const name = (row[cols.name] ?? '').trim()
      const rawGroup = (row[cols.group] ?? '').trim()
      if (!name || shouldSkip(name)) continue

      const resolved = resolveGroup(rawGroup)
      if (!resolved) {
        stats.errors.push(`Linha ${r + 1} ("${name}"): grupo DRE não reconhecido — "${rawGroup}"`)
        continue
      }
      const type = cols.type >= 0 && (row[cols.type] ?? '').trim()
        ? (row[cols.type] ?? '').trim().toUpperCase()
        : resolved.type
      const code = cols.code >= 0 && (row[cols.code] ?? '').trim()
        ? (row[cols.code] ?? '').trim()
        : await nextCode(resolved.dreGroup, usedCodes)

      await upsertAccount({ code, name, type, dreGroup: resolved.dreGroup }, stats)
    }
  } else {
    // ── Formato coluna única com cabeçalhos de seção ───────────────────
    let current: SectionInfo | null = null
    for (let r = 0; r < matrix.length; r++) {
      const name = (matrix[r][0] ?? '').trim()
      if (!name || shouldSkip(name)) continue

      const section = resolveGroup(name)
      if (section) { current = section; continue }
      if (!current) continue

      const code = await nextCode(current.dreGroup, usedCodes)
      await upsertAccount({ code, name, type: current.type, dreGroup: current.dreGroup }, stats)
    }
  }

  if (stats.imported === 0 && stats.updated === 0 && stats.errors.length === 0) {
    return NextResponse.json({
      error: 'Nenhuma conta reconhecida. Use colunas Código / Nome / Grupo DRE, ' +
        'ou uma coluna única com os grupos como cabeçalhos de seção.',
    }, { status: 422 })
  }

  return NextResponse.json(stats)
}

async function upsertAccount(
  acc: { code: string; name: string; type: string; dreGroup: string },
  stats: { imported: number; updated: number; errors: string[] }
) {
  try {
    const existing = await prisma.account.findFirst({
      where: { OR: [{ code: acc.code }, { name: acc.name, dreGroup: acc.dreGroup }] },
    })
    if (existing) {
      await prisma.account.update({
        where: { id: existing.id },
        data: { name: acc.name, type: acc.type, dreGroup: acc.dreGroup },
      })
      stats.updated++
    } else {
      await prisma.account.create({ data: acc })
      stats.imported++
    }
  } catch (e: unknown) {
    stats.errors.push(`"${acc.name}": ${e instanceof Error ? e.message : String(e)}`)
  }
}
