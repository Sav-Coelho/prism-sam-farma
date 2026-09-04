'use client'
import { useEffect, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import AccountCombobox from '@/components/AccountCombobox'
import { MONTH_NAMES } from '@/lib/dre'

const ACCEPT = '.xlsx,.XLSX,.xls,.XLS,.csv,.CSV'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR')

const now = new Date()
const YEARS = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

type Filter = 'all' | 'sem-conta' | 'sem-unidade' | 'pendente' | 'entradas' | 'saidas'

interface PagamentoRow {
  fitid: string
  erpKey: string
  credor: string
  documento: string
  unidade: string
  unidadeApelido: string
  valor: number
  vencimento: string
  pagamento: string | null
  status: 'REALIZADO' | 'PENDENTE'
  month: number
  year: number
}

interface RecebimentoRow {
  fitid: string
  canal: string
  valor: number
  status: 'REALIZADO' | 'PENDENTE'
  month: number
  year: number
  unidade?: string
}

interface Previa {
  kind: 'pagamentos' | 'recebimentos'
  fileName: string
  rows: PagamentoRow[] | RecebimentoRow[]
  errors: string[]
  totalRealizado: number
  totalPendente: number
  mapa?: Record<string, { dreGroup: string; name: string }>
  chavesNovas?: string[]
  truncated?: boolean
  /** Recebimentos já gravados nos meses do arquivo — serão substituídos */
  substitui?: { year: number; month: number; count: number; total: number }[]
  /** O arquivo traz a unidade de cada linha (recebíveis mensais por loja) */
  comUnidade?: boolean
}

export default function Lancamentos() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [transactions, setTransactions] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [accounts, setAccounts] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedTxIds, setSelectedTxIds] = useState<Set<number>>(new Set())

  const [drag, setDrag] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 6000) }

  const load = () => {
    setLoading(true)
    const unitParam = unitId ? `&unitId=${unitId}` : ''
    Promise.all([
      fetch(`/api/transactions?month=${month}&year=${year}${unitParam}`).then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/units').then(r => r.json()),
    ]).then(([txs, accs, uns]) => {
      setTransactions(Array.isArray(txs) ? txs : [])
      setAccounts(Array.isArray(accs) ? accs : [])
      setUnits(Array.isArray(uns) ? uns : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(load, [month, year, unitId])

  const enviarArquivo = async (file: File) => {
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('ano', String(year))
      const res = await fetch('/api/import/parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { showToast(`Erro: ${data.error}`); setParsing(false); return }

      if (data.kind === 'generico') {
        showToast('Arquivo não reconhecido — esperado o export de Contas a Pagar do ERP ou a planilha de Recebidos')
        setParsing(false)
        return
      }
      setPrevia(data as Previa)
    } catch {
      showToast('Erro ao processar a planilha')
    }
    setParsing(false)
  }

  const salvar = async () => {
    if (!previa) return
    setSaving(true)
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        previa.kind === 'pagamentos'
          ? { kind: 'pagamentos', rows: previa.rows }
          : { kind: 'recebimentos', rows: previa.rows, unitId: previa.comUnidade ? null : (unitId || null) }
      ),
    })
    const data = await res.json()
    if (res.ok) {
      const novas = data.novasChaves?.length
        ? ` · ${data.novasChaves.length} conta(s) nova(s) em "A Classificar"`
        : ''
      const substituidos = data.substituidos
        ? ` · substituíram ${data.substituidos} recebimentos já gravados de ${(data.meses || []).join(', ')}`
        : ''
      showToast(`✓ ${data.imported} gravados${data.skipped ? `, ${data.skipped} já existiam` : ''}${novas}${substituidos}`)
      setPrevia(null)
      load()
    } else {
      showToast(`Erro: ${data.error}`)
    }
    setSaving(false)
  }

  const classify = async (txId: number, accountId: string) => {
    await fetch(`/api/transactions/${txId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: accountId || null })
    })
    setTransactions(prev => prev.map(t =>
      t.id === txId
        ? { ...t, accountId: accountId ? parseInt(accountId) : null, account: accounts.find(a => a.id === parseInt(accountId)) || null }
        : t
    ))
  }

  /** Define a unidade de um lançamento — usado nos recebimentos, que chegam sem loja. */
  const definirUnidade = async (txId: number, novoUnitId: string) => {
    const res = await fetch(`/api/transactions/${txId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId: novoUnitId || null })
    })
    if (!res.ok) { showToast('Erro ao definir a unidade'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unidade = units.find((u: any) => String(u.id) === novoUnitId) ?? null
    setTransactions(prev => prev.map(t =>
      t.id === txId ? { ...t, unitId: novoUnitId ? parseInt(novoUnitId) : null, unit: unidade } : t
    ))
  }

  /** O select em lote manda '__nenhuma' quando a escolha é deixar sem loja. */
  const aplicarUnidadeEmLote = (valor: string) =>
    definirUnidadeSelecionadas(valor === '__nenhuma' ? '' : valor)

  /** Mesma coisa, para tudo que estiver marcado na tabela. */
  const definirUnidadeSelecionadas = async (novoUnitId: string) => {
    const ids = Array.from(selectedTxIds)
    if (ids.length === 0) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unidade = units.find((u: any) => String(u.id) === novoUnitId) ?? null
    const nome = unidade ? unidade.name : 'sem unidade'
    if (!confirm(`Definir ${ids.length} lançamento${ids.length > 1 ? 's' : ''} como ${nome}?`)) return

    const respostas = await Promise.all(ids.map(id =>
      fetch(`/api/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: novoUnitId || null })
      })
    ))
    const falhas = respostas.filter(r => !r.ok).length
    setTransactions(prev => prev.map(t =>
      selectedTxIds.has(t.id) ? { ...t, unitId: novoUnitId ? parseInt(novoUnitId) : null, unit: unidade } : t
    ))
    setSelectedTxIds(new Set())
    showToast(falhas
      ? `${ids.length - falhas} atualizados · ${falhas} falharam`
      : `✓ ${ids.length} lançamento${ids.length > 1 ? 's definidos' : ' definido'} como ${nome}`)
  }

  const remove = async (id: number) => {
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    setTransactions(prev => prev.filter(t => t.id !== id))
    setSelectedTxIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const removeSelected = async () => {
    const ids = Array.from(selectedTxIds)
    if (ids.length === 0) return
    if (!confirm(`Excluir ${ids.length} lançamento${ids.length > 1 ? 's' : ''}?`)) return
    await Promise.all(ids.map(id => fetch(`/api/transactions/${id}`, { method: 'DELETE' })))
    setTransactions(prev => prev.filter(t => !selectedTxIds.has(t.id)))
    showToast(`${ids.length} lançamento${ids.length > 1 ? 's removidos' : ' removido'}`)
    setSelectedTxIds(new Set())
  }

  const toggleTxSelect = (id: number) =>
    setSelectedTxIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const filtered = transactions.filter(t => {
    if (filter === 'sem-conta') return !t.accountId || t.account?.dreGroup === '⚠ A Classificar'
    if (filter === 'sem-unidade') return !t.unitId
    if (filter === 'pendente') return t.status === 'PENDENTE'
    if (filter === 'entradas') return t.amount > 0
    if (filter === 'saidas') return t.amount < 0
    return true
  })

  const semConta = transactions.filter(t => !t.accountId || t.account?.dreGroup === '⚠ A Classificar').length
  const semUnidade = transactions.filter(t => !t.unitId).length
  const pendentes = transactions.filter(t => t.status === 'PENDENTE').length
  const totalEntradas = transactions.filter(t => t.amount > 0 && t.status === 'REALIZADO').reduce((s, t) => s + t.amount, 0)
  const totalSaidas = transactions.filter(t => t.amount < 0 && t.status === 'REALIZADO').reduce((s, t) => s + Math.abs(t.amount), 0)

  const previaPag = previa?.kind === 'pagamentos' ? previa.rows as PagamentoRow[] : []
  const previaRec = previa?.kind === 'recebimentos' ? previa.rows as RecebimentoRow[] : []

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Lançamentos</h1>
          <p className="page-subtitle">Suba o Contas a Pagar do ERP e a planilha de Recebidos — o resto é automático</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 170 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 120 }} value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Upload */}
      {!previa && (
        <div className="mb-6">
          <div className="card mb-3" style={{ padding: '12px 20px', background: '#f4f6fa' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Arquivos aceitos</div>
            <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', lineHeight: 1.7 }}>
              <strong>Contas a Pagar</strong> (export do ERP) — cada título já vem com o Plano de Contas,
              então a classificação na DRE é automática. Títulos <em>pagos</em> entram na DRE pela data de
              pagamento; <em>pendentes</em> vão para o fluxo de caixa projetado pela data de vencimento.<br />
              <strong>Recebíveis do mês</strong> (export do ERP, por canal e loja) — receita por canal. O que está como
              “recebido” entra na DRE; “a receber” alimenta o fluxo projetado. Subir o arquivo de um mês
              <strong> substitui</strong> o que já estava gravado daquele mês — pode reenviar sem duplicar.
            </div>
          </div>
          <div
            className={`upload-zone ${drag ? 'drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) enviarArquivo(f) }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); e.target.value = '' }}
            />
            <div className="upload-icon">{parsing ? '⏳' : '📄'}</div>
            <div className="upload-title">{parsing ? 'Lendo planilha...' : 'Importar planilha'}</div>
            <div className="upload-sub">Clique ou arraste o arquivo — o sistema identifica sozinho qual é</div>
          </div>
        </div>
      )}

      {/* Prévia */}
      {previa && (
        <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                {previa.kind === 'pagamentos' ? '💸 Contas a Pagar' : '💰 Recebidos e Recebíveis'} — {previa.fileName}
              </span>
              <div style={{ fontSize: 12, color: 'var(--brave-gray)', marginTop: 4 }}>
                {previa.rows.length} linhas ·{' '}
                <strong style={{ color: '#1a7a4a' }}>{fmt(previa.totalRealizado)}</strong> realizado ·{' '}
                <strong style={{ color: '#b58b00' }}>{fmt(previa.totalPendente)}</strong>{' '}
                {previa.kind === 'pagamentos' ? 'a pagar (projetado)' : 'a receber (projetado)'}
                {previa.errors.length > 0 && (
                  <span style={{ marginLeft: 6, color: '#c0392b' }}>· {previa.errors.length} linhas ignoradas</span>
                )}
              </div>
              {!!previa.chavesNovas?.length && (
                <div style={{ marginTop: 8, fontSize: 12, background: '#fffbea', border: '1px solid #f0c040', borderRadius: 6, padding: '8px 12px', color: '#7a5c00', maxWidth: 620 }}>
                  <strong>{previa.chavesNovas.length} conta(s) nova(s) no plano do ERP.</strong> Vão entrar como
                  “⚠ A Classificar” (fora do resultado) e aparecem em Plano de Contas para você definir a categoria:
                  <div style={{ marginTop: 4, fontSize: 11, maxHeight: 70, overflowY: 'auto' }}>
                    {previa.chavesNovas.slice(0, 8).map((k, i) => <div key={i}>• {k}</div>)}
                  </div>
                </div>
              )}
              {previa.kind === 'recebimentos' && !!previa.substitui?.length && (
                <div style={{ marginTop: 8, fontSize: 12, background: '#e8f0fe', border: '1px solid #a8c7fa', borderRadius: 6, padding: '8px 12px', color: '#1a5fa8', maxWidth: 620 }}>
                  <strong>Substitui o que já está gravado.</strong> Os recebimentos destes meses serão trocados pelos do arquivo:
                  {previa.substitui.map(s => {
                    const novo = (previa.rows as RecebimentoRow[])
                      .filter(r => r.month === s.month && r.year === s.year)
                      .reduce((acc, r) => acc + r.valor, 0)
                    return (
                      <div key={s.year * 100 + s.month} style={{ fontSize: 11, marginTop: 3 }}>
                        • {MONTH_NAMES[s.month]}/{s.year}: {s.count} lançamento{s.count > 1 ? 's' : ''} ({fmt(s.total)}) → {fmt(novo)} no arquivo
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {previa.kind === 'recebimentos' && !previa.comUnidade && (
                <select className="form-select" style={{ fontSize: 12, width: 180 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
                  <option value="">Sem unidade (consolidado)</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {previa.kind === 'recebimentos' && previa.comUnidade && (
                <span style={{ fontSize: 11, color: 'var(--brave-gray)' }}>a loja de cada linha vem do arquivo</span>
              )}
              <button className="btn btn-primary" onClick={salvar} disabled={saving}>
                {saving ? 'Gravando...' : `Importar ${previa.rows.length} linhas`}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => setPrevia(null)}>Cancelar</button>
            </div>
          </div>

          <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {previa.kind === 'pagamentos' ? (
              <table>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Credor</th>
                    <th>Unidade</th>
                    <th>Categoria na DRE</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {previaPag.slice(0, 300).map(t => {
                    const cat = previa.mapa?.[t.erpKey]
                    return (
                      <tr key={t.fitid}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                          {MONTH_NAMES[t.month]}/{t.year}
                          <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>
                            venc. {fmtDate(t.vencimento)}
                          </div>
                        </td>
                        <td style={{ fontSize: 13, maxWidth: 220 }}>{t.credor}</td>
                        <td style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{t.unidadeApelido || t.unidade}</td>
                        <td style={{ fontSize: 11 }}>
                          {cat
                            ? <span>{cat.dreGroup}</span>
                            : <span style={{ color: '#b58b00' }}>⚠ A Classificar</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: '#c0392b' }}>{fmt(t.valor)}</td>
                        <td>
                          <span style={{
                            fontSize: 11, borderRadius: 4, padding: '2px 6px',
                            background: t.status === 'REALIZADO' ? '#e8f5e9' : '#fff8e1',
                            color: t.status === 'REALIZADO' ? '#1a7a4a' : '#7a5c00',
                          }}>
                            {t.status === 'REALIZADO' ? 'pago — entra na DRE' : 'pendente — projetado'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Competência</th>
                    {previa.comUnidade && <th>Loja</th>}
                    <th>Canal</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {previaRec.map(t => (
                    <tr key={t.fitid}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{MONTH_NAMES[t.month]}/{t.year}</td>
                      {previa.comUnidade && (
                        <td style={{ fontSize: 12, color: 'var(--brave-gray-mid)' }}>
                          {(t.unidade || '—').replace(/^FARMA\s*&\s*FARMA\s*-?\s*/i, '')}
                        </td>
                      )}
                      <td style={{ fontSize: 13 }}>{t.canal}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: '#1a7a4a' }}>{fmt(t.valor)}</td>
                      <td>
                        <span style={{
                          fontSize: 11, borderRadius: 4, padding: '2px 6px',
                          background: t.status === 'REALIZADO' ? '#e8f5e9' : '#fff8e1',
                          color: t.status === 'REALIZADO' ? '#1a7a4a' : '#7a5c00',
                        }}>
                          {t.status === 'REALIZADO' ? 'recebido — entra na DRE' : 'a receber — projetado'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {previaPag.length > 300 && (
            <div style={{ padding: '8px 24px', fontSize: 11, color: 'var(--brave-gray)', borderTop: '1px solid var(--brave-light)' }}>
              Mostrando as 300 primeiras linhas — a importação grava todas as {previa.rows.length}.
            </div>
          )}
        </div>
      )}

      {/* KPIs / filtros */}
      <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {([
          { key: 'all', label: 'Total no período', value: String(transactions.length) },
          { key: 'sem-conta', label: 'A classificar', value: String(semConta), color: semConta > 0 ? '#c0392b' : '#1a7a4a' },
          { key: 'sem-unidade', label: 'Sem unidade', value: String(semUnidade), color: semUnidade > 0 ? '#b58b00' : '#1a7a4a' },
          { key: 'pendente', label: 'Pendentes (projetado)', value: String(pendentes), color: '#b58b00' },
          { key: 'entradas', label: 'Entradas', value: fmt(totalEntradas), color: '#1a7a4a' },
          { key: 'saidas', label: 'Saídas', value: fmt(totalSaidas), color: '#c0392b' },
        ] as { key: Filter; label: string; value: string; color?: string }[]).map(m => (
          <div
            key={m.key}
            className="metric-card"
            style={{ cursor: 'pointer', border: filter === m.key ? '2px solid var(--brave-yellow)' : undefined }}
            onClick={() => setFilter(m.key)}
          >
            <div className="metric-label">{m.label}</div>
            <div className="metric-value" style={{ fontSize: m.key === 'entradas' || m.key === 'saidas' ? 15 : 22, color: m.color }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabela do período */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {unitId ? units.find((u: any) => u.id === parseInt(unitId))?.name : 'Consolidado'} — {MONTH_NAMES[month]}/{year} — {filtered.length} lançamentos
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {filtered.length > 0 && (
              selectedTxIds.size === filtered.length
                ? <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTxIds(new Set())}>Desmarcar todas</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTxIds(new Set(filtered.map(t => t.id)))}>
                    Selecionar as {filtered.length} visíveis
                  </button>
            )}
            {selectedTxIds.size > 0 && (
              <>
                <select
                  className="form-select"
                  style={{ fontSize: 12, width: 210 }}
                  value=""
                  onChange={e => { if (e.target.value !== '') aplicarUnidadeEmLote(e.target.value) }}
                >
                  <option value="">Definir unidade de {selectedTxIds.size}...</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  <option value="__nenhuma">— sem unidade (consolidado) —</option>
                </select>
                <button className="btn btn-danger btn-sm" onClick={removeSelected}>
                  Excluir ({selectedTxIds.size})
                </button>
              </>
            )}
          </div>
        </div>

        {filter === 'sem-unidade' && semUnidade > 0 && (
          <div style={{ padding: '10px 24px', background: '#e8f0fe', fontSize: 12, color: '#1a5fa8', borderBottom: '1px solid var(--brave-light)' }}>
            Estes lançamentos não têm loja. Na DRE por unidade, a receita sem loja é <strong>rateada</strong>
            pela participação no faturamento — ao definir a unidade aqui, o valor passa a ser contabilizado
            como <strong>real</strong> daquela loja, sem rateio.
          </div>
        )}
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--brave-gray)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            Nenhum lançamento no período.
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 600, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Unidade</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th>Conta / Categoria</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 400).map(tx => (
                  <tr key={tx.id} style={{ background: selectedTxIds.has(tx.id) ? '#fef9e7' : undefined }}>
                    <td>
                      <input type="checkbox" checked={selectedTxIds.has(tx.id)}
                        onChange={() => toggleTxSelect(tx.id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtDate(tx.date)}
                      {tx.status === 'PENDENTE' && (
                        <div style={{ fontSize: 10, color: '#b58b00', fontWeight: 600 }}>pendente</div>
                      )}
                    </td>
                    <td style={{ maxWidth: 240 }}>
                      <div style={{ fontSize: 13 }}>{tx.description}</div>
                    </td>
                    <td>
                      <select
                        className="form-select"
                        style={{
                          fontSize: 11, padding: '4px 6px', minWidth: 148,
                          borderColor: tx.unitId ? undefined : '#f0c040',
                          background: tx.unitId ? undefined : '#fffbea',
                        }}
                        value={tx.unitId ? String(tx.unitId) : ''}
                        onChange={e => definirUnidade(tx.id, e.target.value)}
                      >
                        <option value="">— sem unidade —</option>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: tx.amount >= 0 ? '#1a7a4a' : '#c0392b' }}>
                      {fmt(tx.amount)}
                    </td>
                    <td style={{ minWidth: 200 }}>
                      <AccountCombobox
                        accounts={accounts}
                        value={String(tx.accountId || '')}
                        onChange={val => classify(tx.id, val)}
                      />
                      {tx.account?.dreGroup && (
                        <div style={{ fontSize: 10, color: tx.account.dreGroup === '⚠ A Classificar' ? '#c0392b' : 'var(--brave-gray)', marginTop: 2 }}>
                          {tx.account.dreGroup}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(tx.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 400 && (
              <div style={{ padding: '8px 24px', fontSize: 11, color: 'var(--brave-gray)' }}>
                Mostrando 400 de {filtered.length} lançamentos do período.
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
