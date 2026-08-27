'use client'
import { useEffect, useState } from 'react'
import Shell, { EVENTO_MENU } from '@/components/Shell'
import { MONTH_NAMES, DRELineType, DRERowAnual } from '@/lib/dre'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

const pct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '—'

const now = new Date()
const YEARS = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

/** Fundo e peso de cada tipo de linha da DRE. */
function rowStyle(type: DRELineType, indent: number): React.CSSProperties {
  if (type === 'subtotal') return { background: 'var(--brave-light)', fontWeight: 700 }
  if (type === 'section') return { background: '#f8fafb', fontWeight: 700 }
  if (type === 'memo' && indent === 0) return { background: '#eceff1', fontWeight: 700 }
  if (type === 'memo') return { color: '#78909c' }
  if (type === 'group') return { fontWeight: 600 }
  return {}
}

function labelStyle(type: DRELineType, indent: number): React.CSSProperties {
  const base: React.CSSProperties = {
    paddingLeft: 14 + indent * 18,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 330,
  }
  if (type === 'subtotal') return { ...base, fontSize: 12.5, fontFamily: 'var(--font-sub)', fontWeight: 700 }
  if (type === 'section') return { ...base, fontSize: 11, fontFamily: 'var(--font-sub)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brave-gray-mid)' }
  if (type === 'memo' && indent === 0) return { ...base, fontSize: 10.5, fontFamily: 'var(--font-sub)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#546e7a' }
  if (type === 'memo') return { ...base, fontSize: 11.5 }
  if (type === 'group') return { ...base, fontSize: 12.5, fontFamily: 'var(--font-sub)' }
  return { ...base, fontSize: 11.5, color: 'var(--brave-gray-mid)' }
}

function valorCor(type: DRELineType, v: number): string {
  if (v === 0) return 'var(--brave-gray)'
  if (type === 'memo') return '#78909c'
  if (v < 0) return '#c0392b'
  return type === 'subtotal' || type === 'group' || type === 'section' ? '#1a7a4a' : 'var(--brave-dark)'
}

/** Variação percentual entre dois valores, no padrão da aba Análise Horizontal. */
function variacao(de: number, para: number): string {
  if (de === 0) return '—'
  return `${(((para - de) / Math.abs(de)) * 100).toFixed(1)}%`
}

export default function DREPage() {
  const [year, setYear] = useState(now.getFullYear())
  const [unitId, setUnitId] = useState<string>('')
  const [soEstrutura, setSoEstrutura] = useState(false)
  /** Meses (0–11) com a coluna de análise vertical aberta. */
  const [avAbertos, setAvAbertos] = useState<number[]>([])
  /** Tela cheia: esconde o menu e os cards para a tabela ocupar tudo. */
  const [telaCheia, setTelaCheia] = useState(false)

  const alternarTelaCheia = () => {
    const alvo = !telaCheia
    setTelaCheia(alvo)
    window.dispatchEvent(new CustomEvent(EVENTO_MENU, { detail: alvo }))
  }
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
    fetch(`/api/dre?year=${year}${unitParam}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [year, unitId])

  const anual = data?.anual
  const matriz: DRERowAnual[] = data?.matriz ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meses = (data?.yearData ?? []) as any[]

  const unitLabel = unitId ? units.find(u => u.id === parseInt(unitId))?.name : 'Consolidado'
  const mesesComDado = meses.map((m, i) => (m.receitaBruta > 0 || m.lucroLiquido !== 0 ? i : -1)).filter(i => i >= 0)

  const linhas = soEstrutura ? matriz.filter(l => l.type !== 'account') : matriz

  /** Base da análise vertical: receita bruta daquele mês. */
  const baseAV = (i: number) => meses[i]?.receitaBruta ?? 0

  const alternarAV = (i: number) =>
    setAvAbertos(prev => prev.indexOf(i) >= 0 ? prev.filter(x => x !== i) : prev.concat([i]).sort((a, b) => a - b))

  // Extremos do período com dado — base da análise horizontal do ano
  const primeiroMes = mesesComDado.length > 0 ? mesesComDado[0] : -1
  const ultimoMes = mesesComDado.length > 0 ? mesesComDado[mesesComDado.length - 1] : -1
  const temAH = primeiroMes >= 0 && ultimoMes > primeiroMes

  const TH: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 2, background: 'var(--brave-white)',
    textAlign: 'right', padding: '10px 12px', fontSize: 11,
  }

  return (
    <Shell>
      <div className="page-header flex-between" style={telaCheia ? { marginBottom: 12 } : undefined}>
        <div>
          <h1 className="page-title" style={telaCheia ? { fontSize: 18 } : undefined}>DRE Gerencial {year} — {unitLabel}</h1>
          {!telaCheia && <p className="page-subtitle">Regime de caixa · janeiro a dezembro</p>}
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={alternarTelaCheia}>
            {telaCheia ? '⤡ Sair da tela cheia' : '⛶ Tela cheia'}
          </button>
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
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Calculando DRE...</div>
      ) : !anual || anual.receitaBruta === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Sem dados em {year} — {unitLabel}
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe as contas pagas e os recebimentos em Lançamentos
          </div>
        </div>
      ) : (
        <>
          {/* KPIs do ano — saem de cena na tela cheia para a tabela crescer */}
          <div className="metrics-grid mb-6" style={telaCheia ? { display: 'none' } : undefined}>
            {[
              { label: 'Receita Bruta', value: anual.receitaBruta },
              { label: 'Margem de Contribuição', value: anual.margemContribuicao, sub: pct(anual.margemContribuicao, anual.receitaBruta) },
              { label: 'Lucro Operacional', value: anual.lucroOperacional, sub: pct(anual.lucroOperacional, anual.receitaBruta) },
              { label: 'EBITDA', value: anual.ebitda, sub: pct(anual.ebitda, anual.receitaBruta) },
              { label: 'Lucro Líquido Gerencial', value: anual.lucroLiquido, sub: pct(anual.lucroLiquido, anual.receitaBruta) },
            ].map(m => (
              <div className="metric-card" key={m.label}>
                <div className="metric-accent" style={{ background: m.value < 0 ? '#c0392b' : 'var(--brave-yellow)' }} />
                <div className="metric-label">{m.label}</div>
                <div className={`metric-value ${m.value < 0 ? 'negative' : ''}`} style={{ fontSize: 17 }}>
                  R$ {fmt(m.value)}
                </div>
                {m.sub && <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{m.sub} da receita</div>}
              </div>
            ))}
          </div>

          {anual.aClassificar > 0 && !telaCheia && (
            <div className="card mb-6" style={{ padding: '12px 20px', background: '#fffbea', border: '1px solid #f0c040' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#7a5c00' }}>
                ⚠ R$ {fmt(anual.aClassificar)} em contas ainda não classificadas no ano
              </span>
              <span style={{ fontSize: 12, color: '#7a5c00', marginLeft: 8 }}>
                — fora do resultado. Ajuste a categoria em Plano de Contas.
              </span>
            </div>
          )}

          {/* A tabela grande: linhas da DRE × meses.
              Na tela cheia sangra até as bordas, anulando o padding do main. */}
          <div className="card mb-6" style={telaCheia
            ? { padding: 0, overflow: 'hidden', margin: '0 -32px', borderRadius: 0, borderLeft: 'none', borderRight: 'none' }
            : { padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--brave-light)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>
                  Demonstração do Resultado Gerencial — {year} · {unitLabel}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Valores em R$ · competência de caixa · clique no <strong>+</strong> do mês para abrir a análise vertical
                  {mesesComDado.length > 0 && ` · dados de ${MONTH_NAMES[primeiroMes + 1]} a ${MONTH_NAMES[ultimoMes + 1]}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAvAbertos(avAbertos.length > 0 ? [] : mesesComDado)}
                >
                  {avAbertos.length > 0 ? '− Fechar AV%' : '+ AV% em todos os meses'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={soEstrutura} onChange={e => setSoEstrutura(e.target.checked)} />
                  só os totais
                </label>
              </div>
            </div>

            <div style={{
              overflowX: 'auto',
              maxHeight: telaCheia ? 'calc(100vh - 190px)' : 700,
              overflowY: 'auto',
            }}>
              <table style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0, minWidth: 1180 }}>
                <thead>
                  <tr>
                    <th style={{
                      ...TH, textAlign: 'left', left: 0, zIndex: 3, minWidth: 300,
                      borderRight: '2px solid var(--brave-light)',
                    }}>
                      Conta
                    </th>
                    {MONTH_NAMES.slice(1).map((m, i) => {
                      const temDado = mesesComDado.indexOf(i) >= 0
                      const aberto = avAbertos.indexOf(i) >= 0
                      return [
                        <th key={m} style={{ ...TH, minWidth: 100, color: temDado ? 'var(--brave-dark)' : 'var(--brave-gray)' }}>
                          <button
                            onClick={() => alternarAV(i)}
                            title={aberto ? 'Fechar análise vertical de ' + m : 'Abrir análise vertical de ' + m}
                            disabled={!temDado}
                            style={{
                              border: 'none', background: aberto ? 'var(--brave-dark)' : 'var(--brave-light)',
                              color: aberto ? '#fff' : 'var(--brave-gray-mid)',
                              borderRadius: 4, width: 17, height: 17, lineHeight: '15px',
                              fontSize: 12, fontWeight: 700, marginRight: 6, padding: 0,
                              cursor: temDado ? 'pointer' : 'not-allowed', opacity: temDado ? 1 : 0.4,
                            }}
                          >{aberto ? '−' : '+'}</button>
                          {m}
                        </th>,
                        aberto ? (
                          <th key={m + '-av'} style={{ ...TH, minWidth: 62, fontSize: 10, color: 'var(--brave-gray)', background: '#f8fafb' }}>
                            AV %
                          </th>
                        ) : null,
                      ]
                    })}
                    <th style={{ ...TH, minWidth: 112, borderLeft: '2px solid var(--brave-light)', color: 'var(--brave-dark)' }}>
                      Total {year}
                    </th>
                    <th style={{ ...TH, minWidth: 88, background: '#f8fafb' }}>
                      AH ano
                      <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--brave-gray)' }}>
                        {temAH ? MONTH_NAMES[primeiroMes + 1] + ' → ' + MONTH_NAMES[ultimoMes + 1] : '—'}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, i) => {
                    const estilo = rowStyle(linha.type, linha.indent)
                    const cabecalhoMemo = linha.type === 'memo' && linha.indent === 0
                    return (
                      <tr key={i} style={estilo}>
                        <td style={{
                          ...labelStyle(linha.type, linha.indent),
                          position: 'sticky', left: 0, zIndex: 1,
                          background: (estilo.background as string) ?? 'var(--brave-white)',
                          borderRight: '2px solid var(--brave-light)',
                          padding: '7px 12px',
                          paddingLeft: 14 + linha.indent * 18,
                        }}>
                          {linha.label}
                          {linha.sublabel && (
                            <span style={{ fontSize: 10, color: 'var(--brave-gray)', marginLeft: 6 }}>{linha.sublabel}</span>
                          )}
                        </td>
                        {linha.values.map((v, j) => [
                          <td key={j} style={{
                            textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap',
                            color: valorCor(linha.type, v),
                            fontWeight: linha.type === 'subtotal' ? 700 : undefined,
                          }}>
                            {cabecalhoMemo || v === 0 ? '—' : fmt(v)}
                          </td>,
                          avAbertos.indexOf(j) >= 0 ? (
                            <td key={j + '-av'} style={{
                              textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap',
                              fontSize: 11, background: '#f8fafb',
                              color: linha.type === 'subtotal' ? valorCor(linha.type, v) : 'var(--brave-gray-mid)',
                              fontWeight: linha.type === 'subtotal' ? 700 : undefined,
                            }}>
                              {/* o % acompanha o sinal do valor ao lado: prejuízo aparece negativo */}
                              {cabecalhoMemo || v === 0 ? '—' : pct(v, baseAV(j))}
                            </td>
                          ) : null,
                        ])}
                        <td style={{
                          textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap',
                          borderLeft: '2px solid var(--brave-light)',
                          color: valorCor(linha.type, linha.total),
                          fontWeight: linha.type === 'subtotal' || linha.type === 'group' ? 700 : 600,
                        }}>
                          {cabecalhoMemo || linha.total === 0 ? '—' : fmt(linha.total)}
                        </td>
                        <td style={{
                          textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap',
                          fontSize: 11, background: '#f8fafb',
                          color: (() => {
                            if (cabecalhoMemo || !temAH) return 'var(--brave-gray)'
                            const de = linha.values[primeiroMes], para = linha.values[ultimoMes]
                            if (de === 0) return 'var(--brave-gray)'
                            // Em despesa (valor negativo) crescer é ruim; em receita é bom
                            const cresceu = para > de
                            const positivo = de >= 0 ? cresceu : !cresceu
                            return positivo ? '#1a7a4a' : '#c0392b'
                          })(),
                          fontWeight: linha.type === 'subtotal' ? 700 : undefined,
                        }}>
                          {cabecalhoMemo || !temAH ? '—' : variacao(linha.values[primeiroMes], linha.values[ultimoMes])}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ponto de equilíbrio — análise adicional ao modelo da planilha */}
          <div className="card" style={telaCheia ? { display: 'none' } : undefined}>
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              Pontos de Equilíbrio — acumulado {year}
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
              Receita mínima para zerar o resultado · margem de contribuição de {(anual.mcPct * 100).toFixed(1)}% da receita
            </div>
            {anual.mcPct > 0 ? (
              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
                {[
                  { sigla: 'PEO', label: 'Operacional', value: anual.peo, hint: 'cobre as despesas operacionais' },
                  { sigla: 'PEI', label: 'Com impostos e financeiras', value: anual.pei, hint: 'cobre operacionais + impostos + financeiras' },
                  { sigla: 'PEF', label: 'Financeiro', value: anual.pef, hint: 'cobre todos os desembolsos, inclusive sócios e CAPEX', highlight: true },
                ].map(pe => {
                  const atingido = anual.receitaBruta >= pe.value
                  return (
                    <div key={pe.sigla} className="metric-card" style={pe.highlight ? { border: '2px solid var(--brave-yellow)' } : undefined}>
                      <div className="metric-accent" style={{ background: atingido ? '#1a7a4a' : '#c0392b' }} />
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 13 }}>{pe.sigla}</span>
                        <span style={{ fontSize: 10, color: atingido ? '#1a7a4a' : '#c0392b', fontWeight: 600 }}>
                          {atingido ? '✓ atingido' : '✗ não atingido'}
                        </span>
                      </div>
                      <div className="metric-value" style={{ fontSize: 17 }}>R$ {fmt(pe.value)}</div>
                      <div style={{ fontSize: 10, color: 'var(--brave-gray)', marginTop: 2 }}>{pe.label} — {pe.hint}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--brave-gray)', padding: '8px 0' }}>
                Margem de contribuição não positiva no período — ponto de equilíbrio não calculável.
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  )
}
