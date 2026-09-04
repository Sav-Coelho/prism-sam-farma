'use client'
import { useEffect, useRef, useState } from 'react'
import Shell from '@/components/Shell'

const ACCEPT = '.xlsx,.XLSX,.xls,.XLS,.csv,.CSV'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtNum = (v: number, dec = 0) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
const fmtPct = (v: number | null, dec = 1) =>
  v === null || v === undefined ? '—' : (v * 100).toFixed(dec).replace('.', ',') + '%'
const fmtData = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

const SITUACOES = ['Repor', 'OK', 'Excesso', 'Sem giro', 'Sem cadastro']
const COR_SITUACAO: Record<string, { bg: string; fg: string }> = {
  'Repor':        { bg: '#fdecea', fg: '#c0392b' },
  'OK':           { bg: '#e8f5e9', fg: '#1a7a4a' },
  'Excesso':      { bg: '#fff8e1', fg: '#b58b00' },
  'Sem giro':     { bg: '#eceff1', fg: '#546e7a' },
  'Sem cadastro': { bg: '#e8f0fe', fg: '#1a5fa8' },
}
const KIND_LABEL: Record<string, string> = {
  estoque: 'Estoque', vendas: 'Vendas por item', diario: 'Diário de vendas',
}

interface Previa {
  kind: string
  unidade: string
  resumo: Record<string, number | string>
  errors: string[]
}

export default function EstoquePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const [unitId, setUnitId] = useState<string>('')
  const [situacao, setSituacao] = useState('')
  const [abc, setAbc] = useState('')
  const [busca, setBusca] = useState('')
  const [soMercadoria, setSoMercadoria] = useState(false)
  const [sort, setSort] = useState('compra')

  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [drag, setDrag] = useState(false)
  const [paramsAbertos, setParamsAbertos] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [form, setForm] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 6000) }

  const load = () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (unitId) qs.set('unitId', unitId)
    if (situacao) qs.set('situacao', situacao)
    if (abc) qs.set('abc', abc)
    if (busca.trim()) qs.set('q', busca.trim())
    if (soMercadoria) qs.set('soMercadoria', '1')
    qs.set('sort', sort)
    fetch('/api/estoque?' + qs.toString())
      .then(r => r.json())
      .then(d => {
        setData(d)
        if (!unitId && d.unitId) setUnitId(String(d.unitId))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [unitId, situacao, abc, soMercadoria, sort])
  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  const analisar = async (f: File) => {
    if (!unitId) { showToast('Selecione a loja antes de importar'); return }
    setEnviando(true)
    setArquivo(f)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('unitId', unitId)
      fd.append('dry', '1')
      const res = await fetch('/api/estoque/import', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { showToast('Erro: ' + d.error); setArquivo(null) }
      else setPrevia(d as Previa)
    } catch {
      showToast('Erro ao ler o arquivo')
      setArquivo(null)
    }
    setEnviando(false)
  }

  const confirmar = async () => {
    if (!arquivo || !unitId) return
    setGravando(true)
    try {
      const fd = new FormData()
      fd.append('file', arquivo)
      fd.append('unitId', unitId)
      const res = await fetch('/api/estoque/import', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) showToast('Erro: ' + d.error)
      else {
        showToast(`✓ ${KIND_LABEL[d.kind] ?? d.kind} de ${d.unidade}: ${d.gravados} linhas gravadas (substituiu o anterior)`)
        setPrevia(null)
        setArquivo(null)
        load()
      }
    } catch {
      showToast('Erro ao gravar')
    }
    setGravando(false)
  }

  const salvarParams = async () => {
    const res = await fetch('/api/estoque/params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const d = await res.json()
    if (!res.ok) { showToast('Erro: ' + d.error); return }
    setParamsAbertos(false)
    showToast('✓ Parâmetros salvos')
    load()
  }

  const painelLoja = data?.painel?.lojas?.find((l: { unitId: number }) => l.unitId === data.unitId)
  const agregado = data?.painel?.agregado
  const contagens: Record<string, number> = data?.contagens ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const produtos: any[] = data?.produtos ?? []
  const settings = data?.settings
  const unidadeNome = data?.unidades?.find((u: { id: number }) => u.id === data?.unitId)?.name ?? ''

  const CAMPOS_PARAMS: { campo: string; label: string; pct?: boolean }[] = [
    { campo: 'metaMargem', label: 'Meta de margem bruta', pct: true },
    { campo: 'pctCustosVar', label: '% custos variáveis', pct: true },
    { campo: 'custoFixoMensal', label: 'Custo fixo agregado (R$/mês)' },
    { campo: 'periodoMeses', label: 'Período das vendas (meses)' },
    { campo: 'leadTimeDias', label: 'Prazo de entrega (dias)' },
    { campo: 'cicloDias', label: 'Ciclo de reposição (dias)' },
    { campo: 'segurancaDias', label: 'Estoque de segurança (dias)' },
    { campo: 'nivelServicoZ', label: 'Nível de serviço z' },
    { campo: 'minDiasDiario', label: 'Mín. dias de diário (modo σ)' },
    { campo: 'benchmarkMargem', label: 'Benchmark margem (RD)', pct: true },
  ]

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Estoque &amp; Compras{unidadeNome ? ` — ${unidadeNome}` : ''}</h1>
          <p className="page-subtitle">Margem e reposição por produto, a partir dos relatórios do ERP</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 170 }} value={unitId} onChange={e => { setUnitId(e.target.value); setSituacao('') }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(data?.unidades ?? []).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}{u.temDados ? '' : ' (sem dados)'}</option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setForm({ ...settings }); setParamsAbertos(true) }}
            disabled={!settings}
          >⚙ Parâmetros</button>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !data?.unitId ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Sem dados de estoque ainda</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Selecione a loja e suba os relatórios do ERP: Estoque, Vendas por item e Diário de vendas
          </div>
        </div>
      ) : (
        <>
          {/* Painel — réplica da aba "Painel" da planilha */}
          {painelLoja && (
            <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: 'var(--brave-dark)' }} />
                <div className="metric-label">Faturamento (período)</div>
                <div className="metric-value" style={{ fontSize: 15 }}>{fmt(painelLoja.faturamentoTotal)}</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{fmt(painelLoja.faturamentoMedioMensal)}/mês</div>
              </div>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: (painelLoja.vsBenchmark ?? 0) >= 0 ? '#1a7a4a' : '#c0392b' }} />
                <div className="metric-label">Margem bruta realizada</div>
                <div className="metric-value" style={{ fontSize: 17 }}>{fmtPct(painelLoja.margemBruta)}</div>
                <div style={{ fontSize: 11, color: (painelLoja.vsBenchmark ?? 0) >= 0 ? '#1a7a4a' : '#c0392b', marginTop: 2 }}>
                  {fmtPct(painelLoja.vsBenchmark)} vs benchmark ({fmtPct(settings?.benchmarkMargem)})
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: (painelLoja.margemContribuicao ?? 0) > 0 ? '#1a7a4a' : '#c0392b' }} />
                <div className="metric-label">Margem de contribuição</div>
                <div className="metric-value" style={{ fontSize: 17, color: (painelLoja.margemContribuicao ?? 0) > 0 ? '#1a7a4a' : '#c0392b' }}>
                  {fmtPct(painelLoja.margemContribuicao)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>margem − {fmtPct(settings?.pctCustosVar)} variáveis</div>
              </div>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: '#8d99ae' }} />
                <div className="metric-label">Custo fixo rateado</div>
                <div className="metric-value" style={{ fontSize: 15 }}>{fmt(painelLoja.custoFixoRateado)}</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>por mês, via share do faturamento</div>
              </div>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: painelLoja.pontoEquilibrio ? 'var(--brave-yellow)' : '#c0392b' }} />
                <div className="metric-label">Ponto de equilíbrio/mês</div>
                <div className="metric-value" style={{ fontSize: 15, color: painelLoja.pontoEquilibrio ? 'var(--brave-dark)' : '#c0392b' }}>
                  {painelLoja.pontoEquilibrio ? fmt(painelLoja.pontoEquilibrio) : 'n/d (MC ≤ 0)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>custo fixo ÷ MC</div>
              </div>
              <div className="metric-card">
                <div className="metric-accent" style={{ background: 'var(--brave-yellow)' }} />
                <div className="metric-label">Duas lojas (agregado)</div>
                <div className="metric-value" style={{ fontSize: 15 }}>{agregado ? fmt(agregado.faturamentoCombinado) : '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{agregado ? fmt(agregado.faturamentoMedioMensal) + '/mês' : ''}</div>
              </div>
            </div>
          )}

          <div className="card mb-6" style={{ padding: '12px 20px', background: '#f4f6fa' }}>
            <span style={{ fontSize: 12, color: 'var(--brave-gray-mid)' }}>
              {data.modoSigma
                ? <>Reposição no <strong>modo σ</strong>: demanda e desvio calculados do diário ({data.diasDiario} dias corridos).</>
                : <>Reposição pelo <strong>período de vendas</strong> ({settings ? fmtNum(settings.periodoMeses, 2) : '—'} meses).
                  Diário com {data.diasDiario} dia(s) — o modo σ (nível de serviço z) ativa com ≥ {settings?.minDiasDiario} dias.</>}
              {' '}Atualizações: estoque {fmtData(data.atualizadoEm?.estoque)} · vendas {fmtData(data.atualizadoEm?.vendas)} · diário {fmtData(data.atualizadoEm?.diario)}.
            </span>
          </div>

          {/* Upload dos relatórios */}
          {!previa ? (
            <div
              className={`upload-zone mb-6 ${drag ? 'drag' : ''}`}
              style={{ padding: 18 }}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) analisar(f) }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) analisar(f); e.target.value = '' }} />
              <div className="upload-title" style={{ fontSize: 13 }}>
                {enviando ? '⏳ Lendo relatório...' : `📄 Importar relatório do ERP para ${unidadeNome}`}
              </div>
              <div className="upload-sub">Estoque · Vendas por item · Diário de vendas — o sistema identifica qual é. Reimportar substitui, nunca soma.</div>
            </div>
          ) : (
            <div className="card mb-6" style={{ padding: '14px 20px', background: '#fffbea', border: '1px solid #f0c040' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {KIND_LABEL[previa.kind] ?? previa.kind} — {previa.unidade}
              </div>
              <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', marginBottom: 10 }}>
                {Object.keys(previa.resumo).map(k => (
                  <span key={k} style={{ marginRight: 14 }}>
                    <strong>{k}:</strong>{' '}
                    {typeof previa.resumo[k] === 'number' ? fmtNum(previa.resumo[k] as number, /valor|fatur/i.test(k) ? 2 : 0) : String(previa.resumo[k])}
                  </span>
                ))}
                {previa.errors.length > 0 && <span style={{ color: '#c0392b' }}>· {previa.errors.length} avisos</span>}
              </div>
              <div style={{ fontSize: 12, color: '#7a5c00', marginBottom: 10 }}>
                A importação <strong>substitui</strong> o {KIND_LABEL[previa.kind]?.toLowerCase()} atual de {previa.unidade}
                {previa.kind === 'diario' ? ' apenas nos dias presentes no arquivo' : ''}.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={confirmar} disabled={gravando}>
                  {gravando ? 'Gravando...' : 'Confirmar importação'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setPrevia(null); setArquivo(null) }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Filtros + tabela */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--brave-light)' }}>
              {SITUACOES.map(s => {
                const ativa = situacao === s
                const cor = COR_SITUACAO[s]
                return (
                  <button key={s} onClick={() => setSituacao(ativa ? '' : s)} style={{
                    border: ativa ? `2px solid ${cor.fg}` : '1px solid var(--brave-light)',
                    background: cor.bg, color: cor.fg, borderRadius: 14, padding: '3px 10px',
                    fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  }}>
                    {s} {contagens[s] ? `(${contagens[s]})` : '(0)'}
                  </button>
                )
              })}
              <select className="form-select" style={{ width: 90, fontSize: 12 }} value={abc} onChange={e => setAbc(e.target.value)}>
                <option value="">ABC</option>
                {['A', 'B', 'C', 'D'].map(x => <option key={x}>{x}</option>)}
              </select>
              <select className="form-select" style={{ width: 190, fontSize: 12 }} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="compra">Ordenar: R$ a comprar</option>
                <option value="faturamento">Ordenar: faturamento</option>
                <option value="margem">Ordenar: pior margem</option>
                <option value="giro">Ordenar: maior giro</option>
                <option value="excesso">Ordenar: excesso (R$)</option>
              </select>
              <input className="form-input" style={{ flex: 1, minWidth: 150, fontSize: 12, padding: '6px 10px' }}
                placeholder="Buscar produto ou código..." value={busca} onChange={e => setBusca(e.target.value)} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={soMercadoria} onChange={e => setSoMercadoria(e.target.checked)} />
                só mercadoria
              </label>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Calculando...</div>
            ) : produtos.length === 0 ? (
              <div style={{ padding: 50, textAlign: 'center', color: 'var(--brave-gray)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
                Nenhum produto no filtro — suba o relatório de Vendas por item para alimentar a análise.
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>ABC</th>
                      <th style={{ textAlign: 'right' }}>Giro/mês</th>
                      <th style={{ textAlign: 'right' }}>Margem</th>
                      <th style={{ textAlign: 'right' }}>MC</th>
                      <th style={{ textAlign: 'right' }}>Preço médio</th>
                      <th style={{ textAlign: 'right' }}>Preço sug.</th>
                      <th style={{ textAlign: 'right' }}>Custo</th>
                      <th style={{ textAlign: 'right' }}>Estoque</th>
                      <th style={{ textAlign: 'right' }}>Mín</th>
                      <th style={{ textAlign: 'right' }}>Máx</th>
                      <th style={{ textAlign: 'right' }}>Comprar</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map(p => {
                      const cor = COR_SITUACAO[p.situacao] ?? COR_SITUACAO['OK']
                      return (
                        <tr key={p.productId} style={{ background: !p.elegivel ? '#fafafa' : undefined }}>
                          <td style={{ maxWidth: 240 }}>
                            <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>
                              {p.barcode} · {p.category}{!p.elegivel ? ' · fora do painel' : ''}
                            </div>
                          </td>
                          <td style={{ fontWeight: 700, fontSize: 11.5 }}>{p.abc || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(p.giroMes, 1)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: (p.margemPct ?? 0) < 0 ? '#c0392b' : undefined }}>{fmtPct(p.margemPct)}</td>
                          <td style={{ textAlign: 'right', color: (p.mcPct ?? 0) < 0 ? '#c0392b' : '#1a7a4a' }}>{fmtPct(p.mcPct)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.precoMedio !== null ? fmtNum(p.precoMedio, 2) : '—'}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--brave-gray-mid)' }}>{p.precoSugerido !== null ? fmtNum(p.precoSugerido, 2) : '—'}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtNum(p.custoMedio, 2)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.estoqueAtual !== null ? fmtNum(p.estoqueAtual) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--brave-gray)' }}>{fmtNum(p.estoqueMin)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--brave-gray)' }}>{fmtNum(p.estoqueMax)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {p.sugestaoCompra ? (
                              <>
                                <span style={{ fontWeight: 700 }}>{fmtNum(p.sugestaoCompra)}</span>
                                <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{fmt(p.valorCompra)}</div>
                              </>
                            ) : '—'}
                          </td>
                          <td>
                            <span style={{ fontSize: 10.5, borderRadius: 4, padding: '2px 7px', fontWeight: 600, background: cor.bg, color: cor.fg, whiteSpace: 'nowrap' }}>
                              {p.situacao}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {data.totalProdutos > produtos.length && (
                  <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--brave-gray)' }}>
                    Mostrando {produtos.length} de {fmtNum(data.totalProdutos)} produtos — refine os filtros.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Parâmetros */}
      {paramsAbertos && form && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 460, padding: 24, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 4, fontSize: 15 }}>Parâmetros do motor</h3>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
              Os mesmos da aba “Parâmetros” da planilha. Percentuais em decimal (28% = 0,28).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              {CAMPOS_PARAMS.map(({ campo, label }) => (
                <div key={campo}>
                  <label style={{ fontSize: 11, color: 'var(--brave-gray)', display: 'block', marginBottom: 3 }}>{label}</label>
                  <input className="form-input" type="number" step="any" value={form[campo] ?? ''}
                    onChange={e => setForm({ ...form, [campo]: e.target.value })} />
                </div>
              ))}
            </div>
            <label style={{ fontSize: 11, color: 'var(--brave-gray)', display: 'block', margin: '12px 0 3px' }}>
              Categorias fora do painel (não-mercadoria, separadas por |)
            </label>
            <input className="form-input" value={form.categoriasExcluidas ?? ''}
              onChange={e => setForm({ ...form, categoriasExcluidas: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={() => setParamsAbertos(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarParams}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
