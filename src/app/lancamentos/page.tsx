'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import AccountCombobox from '@/components/AccountCombobox'
import { MONTH_NAMES, TRANSFER_GROUP } from '@/lib/dre'
import { tokenize, jaccardSimilarity } from '@/lib/classifier'
import { mapRows, type ColumnMap, type SignMode, type MappedTx } from '@/lib/import-mapper'

const ACCEPT = '.xlsx,.XLSX,.xls,.XLS,.csv,.CSV'

/** Similaridade mínima para sugerir a mesma conta em linhas parecidas do arquivo. */
const PROPAGATION_THRESHOLD = 0.5

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR')

const now = new Date()
const YEARS = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

type Tab = 'planilha' | 'manual'
type Filter = 'all' | 'sem-conta' | 'classificado' | 'entradas' | 'saidas'

interface RawImport {
  fileName: string
  headers: string[]
  rows: string[][]
  headerRow: number
  map: ColumnMap
  missing: string[]
  truncated: boolean
}

interface Suggestion {
  fitid: string
  accountId: number
  accountName: string
  accountCode: string
  confidence: number
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

  const [tab, setTab] = useState<Tab>('planilha')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Importação de planilha ──────────────────────────────────────────
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [raw, setRaw] = useState<RawImport | null>(null)
  const [colMap, setColMap] = useState<ColumnMap>({ date: -1, description: -1, amount: -1, type: -1, credit: -1 })
  const [signMode, setSignMode] = useState<SignMode>('auto')
  /** 'data' = competência pela data da linha · 'periodo' = tudo no mês/ano do topo */
  const [competencia, setCompetencia] = useState<'data' | 'periodo'>('data')
  const [previewUnitId, setPreviewUnitId] = useState('')
  const [previewBankAccountId, setPreviewBankAccountId] = useState('')
  const [selectedFitids, setSelectedFitids] = useState<Set<string>>(new Set())
  const [previewAccountMap, setPreviewAccountMap] = useState<Record<string, string>>({})
  const [previewTransferDestMap, setPreviewTransferDestMap] = useState<Record<string, { unitId: string; bankAccountId: string }>>({})
  const [existingFitids, setExistingFitids] = useState<Set<string>>(new Set())
  const [showMapping, setShowMapping] = useState(false)

  // ── Classificador ───────────────────────────────────────────────────
  const [suggesting, setSuggesting] = useState(false)
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([])
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const [panelMinimized, setPanelMinimized] = useState(false)
  const panelDragging = useRef(false)
  const panelDragOffset = useRef({ x: 0, y: 0 })

  // ── Lançamento manual ───────────────────────────────────────────────
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [manualDesc, setManualDesc] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualIsExpense, setManualIsExpense] = useState(true)
  const [manualUnitId, setManualUnitId] = useState('')
  const [manualBankAccountId, setManualBankAccountId] = useState('')
  const [manualAccountId, setManualAccountId] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  const isTransferAccount = (accId: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!accounts.find((a: any) => String(a.id) === accId && a.dreGroup === TRANSFER_GROUP)

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

  // Prévia recalculada a cada mudança de mapeamento — sem novo upload
  const preview = useMemo(() => {
    if (!raw || colMap.date < 0 || colMap.amount < 0) return { transactions: [] as MappedTx[], errors: [] as string[] }
    return mapRows(raw.rows, colMap, raw.fileName, signMode, raw.headerRow + 1)
  }, [raw, colMap, signMode])

  const previewTxs = preview.transactions

  // Marca as linhas que já existem no banco (mesmo arquivo importado de novo)
  useEffect(() => {
    if (previewTxs.length === 0) { setExistingFitids(new Set()); return }
    const fitids = previewTxs.map(t => t.fitid)
    fetch('/api/import/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fitids }),
    })
      .then(r => r.json())
      .then((found: string[]) => {
        const set = new Set(found)
        setExistingFitids(set)
        setSelectedFitids(new Set(previewTxs.filter(t => !set.has(t.fitid)).map(t => t.fitid)))
      })
      .catch(() => {
        setExistingFitids(new Set())
        setSelectedFitids(new Set(previewTxs.map(t => t.fitid)))
      })
  }, [previewTxs])

  const runClassifier = (txList: MappedTx[]) => {
    if (txList.length === 0) return
    setSuggesting(true)
    fetch('/api/classify/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memos: txList.map(t => ({ fitid: t.fitid, memo: t.memo })) }),
    })
      .then(r => r.json())
      .then((suggestions: Suggestion[]) => {
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          setPendingSuggestions(suggestions)
          setPanelMinimized(false)
          setPanelPos({ x: Math.max(16, window.innerWidth / 2 - 190), y: Math.max(16, window.innerHeight / 2 - 180) })
        }
      })
      .catch(() => {})
      .finally(() => setSuggesting(false))
  }

  const resetPreview = () => {
    setRaw(null)
    setColMap({ date: -1, description: -1, amount: -1, type: -1, credit: -1 })
    setSelectedFitids(new Set())
    setPreviewAccountMap({})
    setPreviewTransferDestMap({})
    setExistingFitids(new Set())
    setPendingSuggestions([])
    setPanelPos(null)
    setShowMapping(false)
  }

  const parseFile = async (file: File) => {
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import/parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { showToast(`Erro: ${data.error}`); setParsing(false); return }

      const imported: RawImport = data
      setRaw(imported)
      setColMap(imported.map)
      setPreviewAccountMap({})
      setPreviewTransferDestMap({})
      setPreviewUnitId(unitId || (units.length === 1 ? String(units[0].id) : ''))
      setPreviewBankAccountId('')
      setShowMapping(imported.missing.length > 0)

      if (imported.missing.length > 0) {
        showToast(`⚠ Colunas não identificadas: ${imported.missing.join(', ')} — ajuste o mapeamento`)
      } else {
        const mapped = mapRows(imported.rows, imported.map, imported.fileName, 'auto', imported.headerRow + 1)
        runClassifier(mapped.transactions)
      }
      if (imported.truncated) {
        showToast('⚠ Planilha muito grande — apenas as primeiras 5000 linhas foram lidas')
      }
    } catch {
      showToast('Erro ao processar a planilha')
    }
    setParsing(false)
  }

  const handlePreviewAccountChange = (fitid: string, accountId: string) => {
    const newMap = { ...previewAccountMap, [fitid]: accountId }
    setPreviewAccountMap(newMap)
    if (!isTransferAccount(accountId)) {
      setPreviewTransferDestMap(prev => { const n = { ...prev }; delete n[fitid]; return n })
    }

    // Propaga como sugestão (nunca aplica direto) para linhas parecidas do arquivo
    if (isTransferAccount(accountId) || !accountId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = accounts.find((a: any) => String(a.id) === accountId)
    const thisTx = previewTxs.find(t => t.fitid === fitid)
    if (!account || !thisTx) return

    const thisTokens = tokenize(thisTx.memo)
    const alreadyInPanel = new Set(pendingSuggestions.map(s => s.fitid))
    const novas: Suggestion[] = []

    previewTxs.forEach(t => {
      if (t.fitid === fitid || existingFitids.has(t.fitid)) return
      if (alreadyInPanel.has(t.fitid) || newMap[t.fitid]) return
      const score = jaccardSimilarity(thisTokens, tokenize(t.memo))
      if (score >= PROPAGATION_THRESHOLD) {
        novas.push({
          fitid: t.fitid,
          accountId: parseInt(accountId),
          accountName: account.name,
          accountCode: account.code,
          confidence: Math.round(score * 100),
        })
      }
    })

    if (novas.length > 0) {
      setPendingSuggestions(prev => prev.concat(novas))
      setPanelPos(prev => prev ?? { x: Math.max(16, window.innerWidth / 2 - 190), y: Math.max(16, window.innerHeight / 2 - 180) })
      setPanelMinimized(false)
    }
  }

  const closePanel = () => { setPendingSuggestions([]); setPanelPos(null) }

  const acceptAllFromPanel = () => {
    const applied: Record<string, string> = {}
    pendingSuggestions.forEach(s => { applied[s.fitid] = String(s.accountId) })
    setPreviewAccountMap(prev => ({ ...applied, ...prev }))
    const n = pendingSuggestions.length
    closePanel()
    showToast(`✓ ${n} classificações aplicadas`)
  }

  const acceptSuggestion = (fitid: string, accountId: number) => {
    setPreviewAccountMap(prev => ({ ...prev, [fitid]: String(accountId) }))
    setPendingSuggestions(prev => {
      const remaining = prev.filter(s => s.fitid !== fitid)
      if (remaining.length === 0) setPanelPos(null)
      return remaining
    })
  }

  const denySuggestion = (fitid: string) => {
    setPendingSuggestions(prev => {
      const remaining = prev.filter(s => s.fitid !== fitid)
      if (remaining.length === 0) setPanelPos(null)
      return remaining
    })
  }

  const handlePanelDragStart = (e: React.MouseEvent) => {
    if (!panelPos) return
    panelDragging.current = true
    panelDragOffset.current = { x: e.clientX - panelPos.x, y: e.clientY - panelPos.y }
    const onMove = (ev: MouseEvent) => {
      if (!panelDragging.current) return
      setPanelPos({ x: ev.clientX - panelDragOffset.current.x, y: ev.clientY - panelDragOffset.current.y })
    }
    const onUp = () => {
      panelDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const toggleSelect = (fitid: string) =>
    setSelectedFitids(prev => {
      const next = new Set(prev)
      if (next.has(fitid)) next.delete(fitid); else next.add(fitid)
      return next
    })

  const selectableTxs = previewTxs.filter(t => !existingFitids.has(t.fitid))

  const saveSelected = async () => {
    if (!previewUnitId) { showToast('Selecione a unidade antes de salvar'); return }
    const toSave = previewTxs
      .filter(t => selectedFitids.has(t.fitid))
      .map(t => ({
        fitid: t.fitid,
        date: t.date,
        amount: t.amount,
        memo: t.memo,
        accountId: previewAccountMap[t.fitid] || null,
        transferToUnitId: previewTransferDestMap[t.fitid]?.unitId || null,
        transferToBankAccountId: previewTransferDestMap[t.fitid]?.bankAccountId || null,
      }))

    if (toSave.length === 0) { showToast('Selecione ao menos um lançamento'); return }

    setSaving(true)
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: toSave,
        unitId: previewUnitId,
        bankAccountId: previewBankAccountId || null,
        overrideMonth: competencia === 'periodo' ? month : null,
        overrideYear: competencia === 'periodo' ? year : null,
      })
    })
    const data = await res.json()
    if (res.ok) {
      showToast(`✓ ${data.imported} importados${data.skipped ? `, ${data.skipped} já existiam` : ''}`)
      resetPreview()
      load()
    } else {
      showToast(`Erro: ${data.error}`)
    }
    setSaving(false)
  }

  const saveManual = async () => {
    if (!manualDate || !manualDesc.trim() || !manualAmount || !manualUnitId) {
      showToast('Preencha data, descrição, valor e unidade')
      return
    }
    const rawAmt = parseFloat(manualAmount.replace(/\./g, '').replace(',', '.'))
    if (isNaN(rawAmt) || rawAmt === 0) { showToast('Valor inválido'); return }

    setManualSaving(true)
    const amount = manualIsExpense ? -Math.abs(rawAmt) : Math.abs(rawAmt)
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: manualDate,
        description: manualDesc.trim(),
        memo: manualDesc.trim(),
        amount,
        accountId: manualAccountId || null,
        unitId: manualUnitId,
        bankAccountId: manualBankAccountId || null,
      })
    })
    if (res.ok) {
      showToast('✓ Lançamento salvo')
      setManualDesc('')
      setManualAmount('')
      setManualAccountId('')
      load()
    } else {
      const data = await res.json()
      showToast(`Erro: ${data.error || 'desconhecido'}`)
    }
    setManualSaving(false)
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

  const remove = async (id: number) => {
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    setTransactions(prev => prev.filter(t => t.id !== id))
    setSelectedTxIds(prev => { const n = new Set(prev); n.delete(id); return n })
    showToast('Lançamento removido')
  }

  const removeSelected = async () => {
    if (selectedTxIds.size === 0) return
    const ids = Array.from(selectedTxIds)
    if (!confirm(`Excluir ${ids.length} lançamento${ids.length > 1 ? 's' : ''}?`)) return
    await Promise.all(ids.map(id => fetch(`/api/transactions/${id}`, { method: 'DELETE' })))
    setTransactions(prev => prev.filter(t => !selectedTxIds.has(t.id)))
    showToast(`${ids.length} lançamento${ids.length > 1 ? 's removidos' : ' removido'}`)
    setSelectedTxIds(new Set())
  }

  const toggleTxSelect = (id: number) =>
    setSelectedTxIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const filtered = transactions.filter(t => {
    if (filter === 'sem-conta') return !t.accountId
    if (filter === 'classificado') return !!t.accountId
    if (filter === 'entradas') return t.amount > 0
    if (filter === 'saidas') return t.amount < 0
    return true
  })

  const semConta = transactions.filter(t => !t.accountId).length
  const classificado = transactions.filter(t => !!t.accountId).length
  const totalEntradas = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalSaidas = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bankAccountsForUnit = units.find((u: any) => String(u.id) === previewUnitId)?.bankAccounts ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manualBankAccounts = units.find((u: any) => String(u.id) === manualUnitId)?.bankAccounts ?? []

  const previewEntradas = previewTxs.filter(t => t.amount > 0).length
  const previewSaidas = previewTxs.filter(t => t.amount < 0).length

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    border: 'none',
    borderBottom: active ? '3px solid var(--brave-yellow)' : '3px solid transparent',
    background: 'none',
    fontFamily: 'var(--font-sub)',
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    color: active ? 'var(--brave-dark)' : 'var(--brave-gray)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  const colSelect = (
    label: string,
    field: keyof ColumnMap,
    optional = false
  ) => (
    <div key={field}>
      <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--brave-gray)' }}>
        {label}{optional ? ' (opcional)' : ' *'}
      </label>
      <select
        className="form-select"
        style={{ fontSize: 12 }}
        value={colMap[field]}
        onChange={e => setColMap(prev => ({ ...prev, [field]: parseInt(e.target.value) }))}
      >
        <option value={-1}>— nenhuma —</option>
        {(raw?.headers ?? []).map((h, i) => (
          <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>
        ))}
      </select>
    </div>
  )

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Lançamentos</h1>
          <p className="page-subtitle">Importe planilhas de contas pagas e recebidas e classifique no plano de contas</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
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

      {units.length === 0 && !loading && (
        <div className="card mb-6" style={{ background: '#fffbea', border: '1px solid #f0c040', padding: '14px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7a5c00', marginBottom: 4 }}>Cadastre uma unidade antes de importar</div>
          <div style={{ fontSize: 12, color: '#7a5c00' }}>
            Todo lançamento pertence a uma unidade. Vá em <strong>Configuração → Unidades</strong> e crie a unidade (ex.: SAM FARMA) e a conta bancária.
          </div>
        </div>
      )}
      {accounts.length <= 1 && !loading && (
        <div className="card mb-6" style={{ background: '#e8f0fe', border: '1px solid #a8c7fa', padding: '14px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a5fa8', marginBottom: 4 }}>Plano de contas vazio</div>
          <div style={{ fontSize: 12, color: '#1a5fa8' }}>
            Sem plano de contas os lançamentos não entram na DRE. Vá em <strong>Configuração → Plano de Contas</strong> para importar ou cadastrar as contas.
          </div>
        </div>
      )}

      {/* Abas */}
      {!raw && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--brave-light)', marginBottom: 20 }}>
          <button style={TAB_STYLE(tab === 'planilha')} onClick={() => setTab('planilha')}>
            📄 Contas Pagas / Recebidas
          </button>
          <button style={TAB_STYLE(tab === 'manual')} onClick={() => setTab('manual')}>
            ✏️ Lançamento Manual
          </button>
        </div>
      )}

      {/* Upload */}
      {tab === 'planilha' && !raw && (
        <div className="mb-6">
          <div className="card mb-3" style={{ padding: '12px 20px', background: '#f4f6fa' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Como funciona</div>
            <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', lineHeight: 1.7 }}>
              Envie a planilha de <strong>contas pagas</strong> ou <strong>contas recebidas</strong> (.xlsx, .xls ou .csv).
              O sistema identifica as colunas de data, descrição e valor automaticamente — e você pode corrigir o
              mapeamento na prévia. Nada é gravado antes de você conferir e clicar em salvar.
            </div>
          </div>
          <div
            className={`upload-zone ${drag ? 'drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) parseFile(f) }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = '' }}
            />
            <div className="upload-icon">{parsing ? '⏳' : '📄'}</div>
            <div className="upload-title">{parsing ? 'Lendo planilha...' : 'Importar Contas Pagas / Recebidas'}</div>
            <div className="upload-sub">Clique ou arraste o arquivo <strong>.XLSX</strong>, <strong>.XLS</strong> ou <strong>.CSV</strong></div>
          </div>
        </div>
      )}

      {/* Lançamento manual */}
      {tab === 'manual' && !raw && (
        <div className="card mb-6" style={{ padding: '24px 28px', maxWidth: 680 }}>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 15, marginBottom: 20 }}>
            Novo Lançamento Manual
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data *</label>
              <input type="date" className="form-input" value={manualDate} onChange={e => setManualDate(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Unidade *</label>
              <select
                className="form-select"
                value={manualUnitId}
                onChange={e => { setManualUnitId(e.target.value); setManualBankAccountId('') }}
              >
                <option value="">— Selecione —</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descrição *</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Aluguel loja — Ago/2026"
                value={manualDesc}
                onChange={e => setManualDesc(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor (R$) *</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: 1.250,90"
                value={manualAmount}
                onChange={e => setManualAmount(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo</label>
              <div style={{ display: 'flex', gap: 8, height: 38, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="tipo" checked={manualIsExpense} onChange={() => setManualIsExpense(true)} />
                  <span style={{ color: '#c0392b', fontWeight: 600 }}>Despesa (−)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="tipo" checked={!manualIsExpense} onChange={() => setManualIsExpense(false)} />
                  <span style={{ color: '#1a7a4a', fontWeight: 600 }}>Receita (+)</span>
                </label>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Conta Bancária</label>
              <select
                className="form-select"
                value={manualBankAccountId}
                onChange={e => setManualBankAccountId(e.target.value)}
                disabled={!manualUnitId}
              >
                <option value="">— Selecione —</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {manualBankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Plano de Contas</label>
              <AccountCombobox accounts={accounts} value={manualAccountId} onChange={setManualAccountId} />
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={saveManual} disabled={manualSaving}>
              {manualSaving ? 'Salvando...' : 'Salvar lançamento'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              setManualDesc(''); setManualAmount(''); setManualAccountId('')
              setManualUnitId(''); setManualBankAccountId(''); setManualIsExpense(true)
            }}>
              Limpar
            </button>
          </div>
        </div>
      )}

      {/* Prévia da planilha */}
      {raw && (
        <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                📄 {raw.fileName} — {previewTxs.length} lançamentos
              </span>
              <div style={{ fontSize: 12, color: 'var(--brave-gray)', marginTop: 2 }}>
                {selectedFitids.size} selecionados · {existingFitids.size} já importados ·{' '}
                <span style={{ color: '#1a7a4a' }}>{previewEntradas} entradas</span> ·{' '}
                <span style={{ color: '#c0392b' }}>{previewSaidas} saídas</span>
                {preview.errors.length > 0 && (
                  <span style={{ marginLeft: 6, color: '#b58b00' }}>· {preview.errors.length} linhas ignoradas</span>
                )}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowMapping(m => !m)}>
                  {showMapping ? '▲ Ocultar mapeamento' : '⚙ Ajustar colunas e sinais'}
                </button>
                {!suggesting && (
                  <button className="btn btn-secondary btn-sm" onClick={() => runClassifier(selectableTxs)}>
                    💡 Rodar classificador
                  </button>
                )}
                {suggesting && <span style={{ fontSize: 12, color: 'var(--brave-gray)' }}>🔍 buscando sugestões...</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="form-select"
                style={{ fontSize: 12, width: 170 }}
                value={previewUnitId}
                onChange={e => { setPreviewUnitId(e.target.value); setPreviewBankAccountId('') }}
              >
                <option value="">— Unidade * —</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              {previewUnitId && (
                <select
                  className="form-select"
                  style={{ fontSize: 12, width: 170 }}
                  value={previewBankAccountId}
                  onChange={e => setPreviewBankAccountId(e.target.value)}
                >
                  <option value="">— Conta bancária —</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {bankAccountsForUnit.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() =>
                setSelectedFitids(new Set(selectableTxs.filter(t => previewAccountMap[t.fitid]).map(t => t.fitid)))
              }>Só classificados</button>
              {selectedFitids.size === selectableTxs.length && selectableTxs.length > 0
                ? <button className="btn btn-secondary btn-sm" onClick={() => setSelectedFitids(new Set())}>Desmarcar todos</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => setSelectedFitids(new Set(selectableTxs.map(t => t.fitid)))}>Selecionar todos</button>
              }
              <button className="btn btn-primary" onClick={saveSelected} disabled={saving || selectedFitids.size === 0 || !previewUnitId}>
                {saving ? 'Salvando...' : `Salvar (${selectedFitids.size})`}
              </button>
              <button className="btn btn-danger btn-sm" onClick={resetPreview}>Cancelar</button>
            </div>
          </div>

          {/* Mapeamento de colunas */}
          {showMapping && (
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', background: '#f8fafb' }}>
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12, marginBottom: 10 }}>
                Mapeamento de colunas — cabeçalho detectado na linha {raw.headerRow + 1}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {colSelect('Data', 'date')}
                {colSelect('Descrição', 'description')}
                {colSelect('Valor', 'amount')}
                {colSelect('Crédito / Entrada', 'credit', true)}
                {colSelect('Natureza (pagar/receber)', 'type', true)}
              </div>

              <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--brave-gray)', marginBottom: 6 }}>SINAL DOS VALORES</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {([
                      { v: 'auto', label: 'Automático' },
                      { v: 'despesa', label: 'Tudo saída (−)' },
                      { v: 'receita', label: 'Tudo entrada (+)' },
                      { v: 'arquivo', label: 'Usar sinal da planilha' },
                    ] as { v: SignMode; label: string }[]).map(o => (
                      <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                        <input type="radio" name="sign" checked={signMode === o.v} onChange={() => setSignMode(o.v)} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--brave-gray)', marginBottom: 6 }}>COMPETÊNCIA NA DRE</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {([
                      { v: 'data', label: 'Data de cada linha' },
                      { v: 'periodo', label: `Tudo em ${MONTH_NAMES[month]}/${year}` },
                    ] as { v: 'data' | 'periodo'; label: string }[]).map(o => (
                      <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                        <input type="radio" name="comp" checked={competencia === o.v} onChange={() => setCompetencia(o.v)} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {preview.errors.length > 0 && (
                <div style={{ marginTop: 14, fontSize: 11, color: '#7a5c00', background: '#fffbea', border: '1px solid #f0c040', borderRadius: 6, padding: '8px 12px', maxHeight: 90, overflowY: 'auto' }}>
                  {preview.errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
                  {preview.errors.length > 8 && <div>… e outras {preview.errors.length - 8} linhas</div>}
                </div>
              )}
            </div>
          )}

          {competencia === 'periodo' && (
            <div style={{ padding: '8px 24px', background: '#e8f0fe', fontSize: 12, color: '#1a5fa8', fontWeight: 600 }}>
              📅 Todos os lançamentos serão contabilizados em {MONTH_NAMES[month]}/{year} — ajuste o mês/ano no topo se necessário
            </div>
          )}

          {previewTxs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
              Nenhum lançamento reconhecido. Use <strong>Ajustar colunas e sinais</strong> para indicar as colunas de data, descrição e valor.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 620, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Conta do Plano</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewTxs.map(tx => {
                    const already = existingFitids.has(tx.fitid)
                    return (
                      <tr key={tx.fitid} style={{ opacity: already ? 0.5 : 1 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedFitids.has(tx.fitid)}
                            disabled={already}
                            onChange={() => toggleSelect(tx.fitid)}
                            style={{ cursor: already ? 'not-allowed' : 'pointer' }}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(tx.date)}</td>
                        <td style={{ maxWidth: 280, fontSize: 13 }}>{tx.memo}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: tx.amount >= 0 ? '#1a7a4a' : '#c0392b' }}>
                          {fmt(tx.amount)}
                        </td>
                        <td style={{ minWidth: 220 }}>
                          {!already ? (
                            <div>
                              <AccountCombobox
                                accounts={accounts}
                                value={previewAccountMap[tx.fitid] || ''}
                                onChange={val => handlePreviewAccountChange(tx.fitid, val)}
                              />
                              {isTransferAccount(previewAccountMap[tx.fitid]) && (
                                <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <select
                                    className="form-select"
                                    style={{ fontSize: 11 }}
                                    value={previewTransferDestMap[tx.fitid]?.unitId || ''}
                                    onChange={e => setPreviewTransferDestMap(prev => ({
                                      ...prev,
                                      [tx.fitid]: { unitId: e.target.value, bankAccountId: '' }
                                    }))}
                                  >
                                    <option value="">— Unidade destino —</option>
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                                  </select>
                                  {previewTransferDestMap[tx.fitid]?.unitId && (
                                    <select
                                      className="form-select"
                                      style={{ fontSize: 11 }}
                                      value={previewTransferDestMap[tx.fitid]?.bankAccountId || ''}
                                      onChange={e => setPreviewTransferDestMap(prev => ({
                                        ...prev,
                                        [tx.fitid]: { ...prev[tx.fitid], bankAccountId: e.target.value }
                                      }))}
                                    >
                                      <option value="">— Conta destino —</option>
                                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                      {(units.find((u: any) => String(u.id) === previewTransferDestMap[tx.fitid]?.unitId)?.bankAccounts ?? []).map((b: any) => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : <span style={{ fontSize: 12, color: 'var(--brave-gray)' }}>—</span>}
                        </td>
                        <td>
                          {already
                            ? <span style={{ fontSize: 11, color: 'var(--brave-gray)', background: 'var(--brave-light)', borderRadius: 4, padding: '2px 6px' }}>já importado</span>
                            : <span style={{ fontSize: 11, color: '#1a7a4a' }}>novo</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* KPIs / filtros do período */}
      <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {([
          { key: 'all', label: 'Total no período', value: String(transactions.length), color: undefined },
          { key: 'sem-conta', label: 'Sem classificação', value: String(semConta), color: semConta > 0 ? '#c0392b' : '#1a7a4a' },
          { key: 'classificado', label: 'Classificados', value: String(classificado), color: '#1a7a4a' },
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
            <div className="metric-value" style={{ fontSize: m.key === 'entradas' || m.key === 'saidas' ? 16 : 22, color: m.color }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabela de lançamentos do período */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {unitId ? units.find((u: any) => u.id === parseInt(unitId))?.name : 'Consolidado'} — {MONTH_NAMES[month]}/{year} — {filtered.length} lançamentos
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {semConta > 0 && (
              <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 500 }}>⚠ {semConta} sem conta</span>
            )}
            {selectedTxIds.size === filtered.length && filtered.length > 0
              ? <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTxIds(new Set())}>Desmarcar todas</button>
              : <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTxIds(new Set(filtered.map(t => t.id)))} disabled={filtered.length === 0}>Selecionar todas</button>
            }
            {selectedTxIds.size > 0 && (
              <button className="btn btn-danger btn-sm" onClick={removeSelected}>
                Excluir selecionadas ({selectedTxIds.size})
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--brave-gray)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            Nenhum lançamento encontrado.<br />
            <span style={{ fontSize: 12 }}>Importe uma planilha de contas pagas/recebidas ou use o lançamento manual.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Unidade</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th>Conta do Plano</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(tx => (
                  <tr key={tx.id} style={{ background: selectedTxIds.has(tx.id) ? '#fef9e7' : undefined }}>
                    <td>
                      <input type="checkbox" checked={selectedTxIds.has(tx.id)}
                        onChange={() => toggleTxSelect(tx.id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(tx.date)}</td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontSize: 13 }}>{tx.description}</div>
                      {tx.memo && tx.memo !== tx.description && (
                        <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{tx.memo}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--brave-gray)', whiteSpace: 'nowrap' }}>
                      {tx.unit?.name || '—'}
                      {tx.bankAccount?.name && <div>{tx.bankAccount.name}</div>}
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
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(tx.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Painel flutuante do classificador */}
      {pendingSuggestions.length > 0 && panelPos && (
        <div style={{
          position: 'fixed', left: panelPos.x, top: panelPos.y, width: 390, zIndex: 600,
          borderRadius: 12, boxShadow: '0 10px 36px rgba(0,0,0,0.22)', background: 'var(--brave-white)',
          border: '1px solid rgba(43,45,66,0.18)', userSelect: 'none',
        }}>
          <div
            onMouseDown={handlePanelDragStart}
            style={{
              padding: '10px 12px', background: 'var(--brave-dark)', cursor: 'grab',
              borderRadius: panelMinimized ? 12 : '12px 12px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15 }}>💡</span>
              <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, color: '#fff' }}>
                Classificador inteligente
              </span>
              <span style={{ background: 'var(--brave-yellow)', color: 'var(--brave-dark)', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                {pendingSuggestions.length}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setPanelMinimized(m => !m)}
                title={panelMinimized ? 'Expandir' : 'Minimizar'}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', fontSize: 11 }}
              >{panelMinimized ? '▲' : '▼'}</button>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={closePanel}
                title="Fechar (negar todas)"
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', fontSize: 13 }}
              >✕</button>
            </div>
          </div>

          {!panelMinimized && (
            <>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {pendingSuggestions.map((s, i) => {
                  const tx = previewTxs.find(t => t.fitid === s.fitid)
                  return (
                    <div key={s.fitid} style={{ padding: '9px 14px', borderBottom: i < pendingSuggestions.length - 1 ? '1px solid var(--brave-light)' : 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                        {tx?.memo ?? s.fitid}
                        {tx && (
                          <span style={{ marginLeft: 8, fontWeight: 400, color: tx.amount >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(tx.amount)}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ fontSize: 11, color: 'var(--brave-gray)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span>{s.accountCode} — </span>{s.accountName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, background: s.confidence >= 70 ? '#e8f5e9' : '#fff8e1', color: s.confidence >= 70 ? '#1a7a4a' : '#7a5c00', borderRadius: 4, padding: '1px 5px' }}>
                            {s.confidence}%
                          </span>
                          <button onClick={() => denySuggestion(s.fitid)} title="Negar"
                            style={{ fontSize: 11, background: '#fdecea', color: '#c0392b', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                            ✕
                          </button>
                          <button onClick={() => acceptSuggestion(s.fitid, s.accountId)} title="Aceitar"
                            style={{ fontSize: 11, background: '#e8f5e9', color: '#1a7a4a', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                            ✓
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--brave-light)', display: 'flex', gap: 6, justifyContent: 'flex-end', background: 'var(--brave-light)', borderRadius: '0 0 12px 12px' }}>
                <button className="btn btn-secondary btn-sm" onClick={closePanel}>Negar todas</button>
                <button className="btn btn-primary btn-sm" onClick={acceptAllFromPanel}>Aceitar todas ({pendingSuggestions.length})</button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
