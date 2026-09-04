/**
 * Validação completa: DRE do sistema × aba "DRE Gerencial" da planilha do cliente,
 * mês a mês, nos dois sentidos. Sem amostragem.
 *
 * O que é verificado, só nos meses que a planilha tem fechados (receita > 0):
 *   1. Toda linha do sistema com par na planilha → valores iguais (± R$ 0,02).
 *   2. Toda linha da planilha com valor → precisa existir no sistema (pega despesa
 *      que a planilha tem e o sistema perdeu, como a Mensalidade Mídia de fev–jun).
 *   3. A linha "Conferência — Total Pago no mês" da própria planilha × total de
 *      saídas REALIZADO do sistema — prova de completude independente do De-Para.
 *
 * O casamento de rótulos ignora o marcador "›", o código contábil ("8.03 - FGTS"
 * ≡ "FGTS") e parênteses finais, e SOMA linhas que caem na mesma chave — é assim
 * que a linha única de FGTS do sistema casa com as duas linhas da planilha.
 *
 * Uso: node .backfill-out/scripts/validar-planilha.js "<planilha.xlsx>" [ano]
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { calcDRE, montarMatrizAnual, MEMO_GROUPS } from '../src/lib/dre'

const prisma = new PrismaClient({ log: ['error'] })
const M = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const TOL = 0.02
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** "R$ 145,817.46" / "-R$ 80.24" (formato da planilha) → number.
 *  Só aceita número puro — "26-Jan" (cabeçalho de mês) não vira 26. */
function num(txt: string): number {
  const limpo = String(txt ?? '').replace(/[R$\s]/g, '').replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return 0
  return parseFloat(limpo)
}

/** Chave de comparação: sem "›", sem código contábil, sem parêntese final. */
function chave(s: string): string {
  return s
    .replace(/^[›>\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d[\d.]*\s*-\s*/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase()
}

interface Mapa { valores: Map<string, number[]>; rotulo: Map<string, string> }

function somar(mapa: Mapa, rot: string, vals: number[]) {
  const k = chave(rot)
  if (!k) return
  const atual = mapa.valores.get(k)
  if (atual) { vals.forEach((v, i) => { atual[i] += v }) }
  else { mapa.valores.set(k, vals.slice()); mapa.rotulo.set(k, rot.replace(/^[›>\s]+/, '').trim()) }
}

async function main() {
  const caminho = process.argv[2]
  const ano = parseInt(process.argv[3] || '') || 2026
  if (!caminho) { console.error('Uso: validar-planilha <planilha.xlsx> [ano]'); process.exit(1) }

  // ── planilha ────────────────────────────────────────────────────────
  const wb = XLSX.readFile(caminho, { cellDates: false, cellFormula: false, cellStyles: false, sheets: ['DRE Gerencial'] })
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['DRE Gerencial'], { header: 1, blankrows: false, defval: '', raw: false })
    .map(l => (l as unknown[]).map(c => String(c ?? '').trim()))

  const idxComp = linhas.findIndex(l => l[0].includes('Competência'))
  if (idxComp < 0) { console.error('Linha de competência não encontrada'); process.exit(1) }
  const colDoMes: Record<number, number> = {}
  linhas[idxComp].forEach((c, i) => {
    const m = c.match(/^(\d{4})(\d{2})$/)
    if (m && parseInt(m[1]) === ano) colDoMes[parseInt(m[2])] = i
  })
  const meses12 = (l: string[]) => {
    const v: number[] = []
    for (let m = 1; m <= 12; m++) v.push(colDoMes[m] === undefined ? 0 : num(l[colDoMes[m]]))
    return v
  }

  // O bloco da DRE termina na linha de auditoria da própria planilha
  const idxTotalPago = linhas.findIndex(l => /confer[êe]ncia/i.test(l[0]) && /total pago/i.test(l[0]))
  const limite = idxTotalPago > 0 ? idxTotalPago : linhas.length

  const plan: Mapa = { valores: new Map(), rotulo: new Map() }
  for (let r = idxComp + 1; r < limite; r++) {
    if (!linhas[r][0].trim()) continue
    somar(plan, linhas[r][0], meses12(linhas[r]))
  }
  const totalPagoPlanilha = idxTotalPago > 0 ? meses12(linhas[idxTotalPago]) : null

  // Meses fechados = meses com receita bruta na planilha
  const receitaPlan = plan.valores.get(chave('(=) RECEITA OPERACIONAL BRUTA')) ?? []
  const mesesCmp: number[] = []
  for (let m = 1; m <= 12; m++) if ((receitaPlan[m - 1] ?? 0) > 0) mesesCmp.push(m)

  // ── sistema ─────────────────────────────────────────────────────────
  const txs = await prisma.transaction.findMany({
    where: { year: ano, accountId: { not: null }, status: 'REALIZADO' },
    include: { account: true },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const porMes = Array.from({ length: 12 }, (_, i) => calcDRE(txs.filter(t => t.month === i + 1) as any, i + 1, ano))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matriz = montarMatrizAnual(calcDRE(txs as any, 0, ano), porMes)

  const sis: Mapa = { valores: new Map(), rotulo: new Map() }
  matriz.forEach(l => {
    if (l.type === 'memo' && l.indent === 0) return
    somar(sis, l.label, l.values)
  })
  // Memo por conta (a matriz só traz os agregados; a planilha detalha CAPEX/A Classificar)
  const memoDetalhe = new Map<string, number[]>()
  txs.forEach(t => {
    if (!t.account || MEMO_GROUPS.indexOf(t.account.dreGroup) < 0) return
    const k = t.account.name
    if (!memoDetalhe.has(k)) memoDetalhe.set(k, Array.from({ length: 12 }, () => 0))
    memoDetalhe.get(k)![t.month - 1] += Math.abs(t.amount)
  })
  Array.from(memoDetalhe.entries()).forEach(([nome, vals]) => somar(sis, nome, vals))

  console.log('Planilha: ' + caminho.split(/[\\/]/).pop())
  console.log('Meses fechados na planilha: ' + mesesCmp.map(m => M[m]).join(', '))
  const mesesSistema = porMes.map((d, i) => (d.receitaBruta > 0 ? i + 1 : 0)).filter(m => m > 0 && mesesCmp.indexOf(m) < 0)
  if (mesesSistema.length) {
    console.log('Sistema à frente da planilha em: ' + mesesSistema.map(m => M[m]).join(', ') + ' (não comparados)')
  }
  console.log('')

  // ── 1. sistema → planilha ───────────────────────────────────────────
  let ok = 0
  const divergencias: string[] = []
  const soSistema: string[] = []   // chaves do sistema sem par na planilha
  Array.from(sis.valores.entries()).forEach(([k, valsSis]) => {
    const valsPlan = plan.valores.get(k)
    if (!valsPlan) {
      const total = mesesCmp.reduce((s, m) => s + Math.abs(valsSis[m - 1]), 0)
      if (total > TOL) soSistema.push(k)
      return
    }
    mesesCmp.forEach(m => {
      const a = Math.abs(valsSis[m - 1]), b = Math.abs(valsPlan[m - 1])
      if (Math.abs(a - b) <= TOL) { ok++; return }
      divergencias.push(
        M[m].padEnd(4) + ' ' + sis.rotulo.get(k)!.slice(0, 44).padEnd(46) +
        'sistema ' + brl(a).padStart(13) + '   planilha ' + brl(b).padStart(13) +
        '   dif ' + brl(a - b).padStart(12)
      )
    })
  })

  // ── 2. planilha → sistema ───────────────────────────────────────────
  // Antes de acusar falta, tenta casar por VALOR com uma linha só do sistema:
  // pega rótulo truncado/grafado diferente na planilha (ex.: "Igarass" × "Igarassu").
  const avisos: string[] = []
  const faltamNoSistema: string[] = []
  const iguais = (a: number[], b: number[]) =>
    mesesCmp.every(m => Math.abs(Math.abs(a[m - 1]) - Math.abs(b[m - 1])) <= TOL)

  Array.from(plan.valores.entries()).forEach(([k, valsPlan]) => {
    if (sis.valores.has(k)) return
    const temValor = mesesCmp.some(m => Math.abs(valsPlan[m - 1]) > TOL)
    if (!temValor) return
    const par = soSistema.find(ks => iguais(sis.valores.get(ks)!, valsPlan))
    if (par) {
      soSistema.splice(soSistema.indexOf(par), 1)
      ok += mesesCmp.length
      avisos.push('"' + plan.rotulo.get(k) + '" (planilha) ≡ "' + sis.rotulo.get(par) + '" (sistema) — mesmos valores, grafia difere')
      return
    }
    mesesCmp.forEach(m => {
      const v = Math.abs(valsPlan[m - 1])
      if (v > TOL) {
        faltamNoSistema.push(M[m].padEnd(4) + ' ' + plan.rotulo.get(k)!.slice(0, 52).padEnd(54) + 'R$ ' + brl(v).padStart(12))
      }
    })
  })

  // ── 3. Total pago no mês (auditoria da própria planilha) ────────────
  const totalPagoDiv: string[] = []
  if (totalPagoPlanilha) {
    const saidasSis = Array.from({ length: 12 }, () => 0)
    txs.forEach(t => { if (t.amount < 0) saidasSis[t.month - 1] += Math.abs(t.amount) })
    mesesCmp.forEach(m => {
      const a = saidasSis[m - 1], b = Math.abs(totalPagoPlanilha[m - 1])
      if (Math.abs(a - b) > TOL) {
        totalPagoDiv.push(M[m].padEnd(4) + ' sistema ' + brl(a).padStart(14) + '   planilha ' + brl(b).padStart(14) + '   dif ' + brl(a - b).padStart(12))
      } else { ok++ }
    })
  }

  // ── resultado ───────────────────────────────────────────────────────
  console.log(ok + ' valores conferem (± R$ 0,02)')

  if (divergencias.length) {
    console.log('\n❌ VALORES DIVERGENTES (' + divergencias.length + '):')
    divergencias.slice(0, 60).forEach(p => console.log('  ' + p))
    if (divergencias.length > 60) console.log('  ... e mais ' + (divergencias.length - 60))
  }
  if (faltamNoSistema.length) {
    console.log('\n❌ NA PLANILHA MAS SEM PAR NO SISTEMA (' + faltamNoSistema.length + '):')
    faltamNoSistema.slice(0, 40).forEach(p => console.log('  ' + p))
    if (faltamNoSistema.length > 40) console.log('  ... e mais ' + (faltamNoSistema.length - 40))
  }
  if (totalPagoDiv.length) {
    console.log('\n❌ TOTAL PAGO NO MÊS DIVERGE (' + totalPagoDiv.length + '):')
    totalPagoDiv.forEach(p => console.log('  ' + p))
  } else if (totalPagoPlanilha) {
    console.log('Total pago mês a mês confere com a linha "Conferência" da planilha.')
  }
  if (avisos.length) {
    console.log('\nℹ Rótulos casados por valor (' + avisos.length + '):')
    avisos.forEach(a => console.log('  ' + a))
  }
  const soSistemaInfo = soSistema.filter(k => sis.rotulo.get(k)![0] !== '(')
  if (soSistemaInfo.length) {
    console.log('\nℹ Linhas só do sistema (sem par na planilha — soma dos meses fechados; os totais acima provam que estão contidas):')
    soSistemaInfo.slice(0, 30).forEach(k => {
      const total = mesesCmp.reduce((s, m) => s + Math.abs(sis.valores.get(k)![m - 1]), 0)
      console.log('  ' + sis.rotulo.get(k)!.slice(0, 52).padEnd(54) + 'R$ ' + brl(total).padStart(12))
    })
    if (soSistemaInfo.length > 30) console.log('  ... e mais ' + (soSistemaInfo.length - 30))
  }

  const falhas = divergencias.length + faltamNoSistema.length + totalPagoDiv.length
  console.log('\n' + (falhas === 0
    ? '✅ DRE 100% igual à planilha nos meses fechados (' + mesesCmp.map(m => M[m]).join(', ') + ').'
    : '❌ ' + falhas + ' problema(s) — ver acima.'))
  if (falhas > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
