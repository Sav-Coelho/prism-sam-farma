'use client'
import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell, ReferenceLine
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR')

const now = new Date()
const YEARS = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

interface MesFluxo {
  month: number
  entradas: number
  saidas: number
  saldo: number
  acumulado: number
  titulos: number
  vencido: number
}

export default function FluxoProjetado() {
  const [year, setYear] = useState(now.getFullYear())
  const [unitId, setUnitId] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [units, setUnits] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/units').then(r => r.json()).then(setUnits).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const unitParam = unitId ? `&unitId=${unitId}` : ''
    fetch(`/api/fluxo?year=${year}${unitParam}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [year, unitId])

  const meses: MesFluxo[] = data?.meses ?? []
  const comMovimento = meses.filter(m => m.titulos > 0)
  const grafico = meses.map(m => ({
    mes: MONTH_NAMES[m.month],
    Entradas: +m.entradas.toFixed(2),
    Saídas: -+m.saidas.toFixed(2),
    'Saldo acumulado': +m.acumulado.toFixed(2),
  }))

  const unitLabel = unitId ? units.find(u => u.id === parseInt(unitId))?.name : 'Consolidado'
  const primeiroNegativo = meses.find(m => m.acumulado < 0)

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Fluxo de Caixa Projetado — {year}</h1>
          <p className="page-subtitle">Títulos pendentes por mês de vencimento · {unitLabel}</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 170 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Consolidado</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : comMovimento.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Sem títulos pendentes em {year}
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe o Contas a Pagar futuro em Lançamentos para montar a projeção
          </div>
        </div>
      ) : (
        <>
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: '#1a7a4a' }} />
              <div className="metric-label">Entradas previstas</div>
              <div className="metric-value" style={{ fontSize: 17, color: '#1a7a4a' }}>{fmt(data.totalEntradas)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>recebíveis do ano</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: '#c0392b' }} />
              <div className="metric-label">Saídas previstas</div>
              <div className="metric-value" style={{ fontSize: 17, color: '#c0392b' }}>{fmt(data.totalSaidas)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{data.totalTitulos} títulos pendentes</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: data.totalEntradas - data.totalSaidas >= 0 ? '#1a7a4a' : '#c0392b' }} />
              <div className="metric-label">Resultado projetado</div>
              <div className="metric-value" style={{ fontSize: 17, color: data.totalEntradas - data.totalSaidas >= 0 ? '#1a7a4a' : '#c0392b' }}>
                {fmt(data.totalEntradas - data.totalSaidas)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>entradas − saídas</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: data.vencido > 0 ? '#c0392b' : 'var(--brave-gray)' }} />
              <div className="metric-label">Vencido em aberto</div>
              <div className="metric-value" style={{ fontSize: 17, color: data.vencido > 0 ? '#c0392b' : 'var(--brave-dark)' }}>
                {fmt(data.vencido)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>títulos com vencimento passado</div>
            </div>
          </div>

          {primeiroNegativo && (
            <div className="card mb-6" style={{ padding: '12px 20px', background: '#fdecea', border: '1px solid #f5c6c0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#c0392b' }}>
                ⚠ Saldo acumulado fica negativo em {MONTH_NAMES[primeiroNegativo.month]}/{year}: {fmt(primeiroNegativo.acumulado)}
              </span>
              <span style={{ fontSize: 12, color: '#c0392b', marginLeft: 8 }}>
                — considerando apenas os recebíveis já lançados.
              </span>
            </div>
          )}

          <div className="card mb-6">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Entradas, saídas e saldo acumulado — {year}
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
              Saldo inicial considerado: {fmt(data.saldoInicial)} (soma dos saldos iniciais das contas bancárias)
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(Math.abs(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#8d99ae" />
                <Bar dataKey="Entradas" fill="#1a7a4a" radius={[3, 3, 0, 0]} barSize={16} />
                <Bar dataKey="Saídas" fill="#c0392b" radius={[0, 0, 3, 3]} barSize={16} />
                <Line type="monotone" dataKey="Saldo acumulado" stroke="#eaca2d" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid-2 mb-6">
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                Projeção mês a mês
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th style={{ textAlign: 'right' }}>Entradas</th>
                      <th style={{ textAlign: 'right' }}>Saídas</th>
                      <th style={{ textAlign: 'right' }}>Saldo do mês</th>
                      <th style={{ textAlign: 'right' }}>Acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comMovimento.map(m => (
                      <tr key={m.month}>
                        <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12 }}>
                          {MONTH_NAMES[m.month]}
                          <div style={{ fontSize: 10, color: 'var(--brave-gray)', fontWeight: 400 }}>{m.titulos} títulos</div>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: '#1a7a4a' }}>{m.entradas > 0 ? fmt(m.entradas) : '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: '#c0392b' }}>{m.saidas > 0 ? fmt(-m.saidas) : '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: m.saldo < 0 ? '#c0392b' : '#1a7a4a' }}>{fmt(m.saldo)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: m.acumulado < 0 ? '#c0392b' : 'var(--brave-dark)' }}>{fmt(m.acumulado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
                Saídas previstas por mês
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={comMovimento.map(m => ({ mes: MONTH_NAMES[m.month], Saídas: +m.saidas.toFixed(2), Vencido: +m.vencido.toFixed(2) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="Saídas" radius={[3, 3, 0, 0]} barSize={26}>
                    {comMovimento.map((m, i) => (
                      <Cell key={i} fill={m.vencido > 0 ? '#c0392b' : '#8d99ae'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 8, textAlign: 'center' }}>
                Barras em vermelho contêm títulos já vencidos
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
              Maiores compromissos — {year}
            </div>
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>Credor</th>
                    <th>Categoria</th>
                    <th>Unidade</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(data.detalhe || []).map((t: any) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: t.vencido ? '#c0392b' : undefined, fontWeight: t.vencido ? 600 : 400 }}>
                        {fmtDate(t.vencimento)}
                        {t.vencido && <div style={{ fontSize: 10 }}>vencido</div>}
                      </td>
                      <td style={{ fontSize: 13, maxWidth: 240 }}>{t.descricao}</td>
                      <td style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{t.categoria}</td>
                      <td style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{t.unidade || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: '#c0392b' }}>{fmt(t.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}
