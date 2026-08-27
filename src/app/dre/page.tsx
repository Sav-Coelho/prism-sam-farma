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
    maxWidth: 420,
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
  /** 'ano' = tabela jan–dez · 'mes' = um mês em detalhe */
  const [visao, setVisao] = useState<'ano' | 'mes'>('ano')
  const [mesSel, setMesSel] = useState(now.getMonth() + 1)
  /** Meses (0–11) com a coluna de análise vertical aberta na tabela anual. */
  const [avAbertos, setAvAbertos] = useState<number[]>([])
  /** Tela cheia: esconde o menu e os cards para a tabela ocupar tudo. */
  const [telaCheia, setTelaCheia] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [units, setUnits] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const alternarTelaCheia = () => {
    const alvo = !telaCheia
    setTelaCheia(alvo)
    window.dispatchEvent(new CustomEvent(EVENTO_MENU, { detail: alvo }))
  }

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
  const rateio = data?.rateio as { metodo: string; participacao: number[] } | null
  const matriz: DRERowAnual[] = data?.matriz ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meses = (data?.yearData ?? []) as any[]
  const mesAtual = meses[mesSel - 1]

  /** DRE do período em foco — o mês escolhido ou o ano inteiro. */
  const foco = visao === 'mes' ? mesAtual : anual

  const unitLabel = unitId ? units.find(u => u.id === parseInt(unitId))?.name : 'Consolidado'
  const mesesComDado = meses.map((m, i) => (m.receitaBruta > 0 || m.lucroLiquido !== 0 ? i : -1)).filter(i => i >= 0)

  const linhasAno = soEstrutura ? matriz.filter(l => l.type !== 'account') : matriz
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhasMes = ((mesAtual?.lines ?? []) as any[]).filter(l => !soEstrutura || l.type !== 'account')

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

  const TOGGLE: React.CSSProperties = {
    display: 'flex', borderRadius: 8, overflow: 'hidden',
    border: '1px solid var(--brave-light)', background: 'var(--brave-light)',
  }
  const TBTN = (ativo: boolean): React.CSSProperties => ({
    padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: 'var(--font-sub)', fontWeight: ativo ? 700 : 500,
    background: ativo ? 'var(--brave-dark)' : 'transparent',
    color: ativo ? '#fff' : 'var(--brave-gray)',
    transition: 'all 0.15s',
  })

  /** Linhas do quadro de ponto de equilíbrio — uma por indicador, meses nas colunas. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LINHAS_PE: { label: string; hint?: string; valor: (d: any) => number; tipo: 'valor' | 'pct'; pe?: boolean; destaque?: boolean }[] = [
    { label: 'Receita realizada', valor: d => d.receitaBruta, tipo: 'valor' },
    { label: 'Margem de contribuição', hint: '% da receita', valor: d => d.mcPct * 100, tipo: 'pct' },
    { label: 'PEO', hint: 'cobre as despesas operacionais', valor: d => d.peo, tipo: 'valor', pe: true },
    { label: 'PEI', hint: '+ impostos e financeiras', valor: d => d.pei, tipo: 'valor', pe: true },
    { label: 'PEF', hint: 'todos os desembolsos, inclusive sócios e CAPEX', valor: d => d.pef, tipo: 'valor', pe: true, destaque: true },
    {
      label: 'Margem de segurança',
      hint: 'quanto a receita supera o PEF',
      valor: d => (d.receitaBruta > 0 && d.pef > 0 ? ((d.receitaBruta - d.pef) / d.receitaBruta) * 100 : 0),
      tipo: 'pct',
    },
  ]

  return (
    <Shell>
      <div className="page-header flex-between" style={telaCheia ? { marginBottom: 12 } : undefined}>
        <div>
          <h1 className="page-title" style={telaCheia ? { fontSize: 18 } : undefined}>
            DRE Gerencial {visao === 'mes' ? `${MONTH_NAMES[mesSel]}/${year}` : year} — {unitLabel}
          </h1>
          {!telaCheia && <p className="page-subtitle">Regime de caixa</p>}
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={TOGGLE}>
            <button style={TBTN(visao === 'ano')} onClick={() => setVisao('ano')}>Ano inteiro</button>
            <button style={TBTN(visao === 'mes')} onClick={() => setVisao('mes')}>Mês específico</button>
          </div>
          {visao === 'mes' && (
            <select className="form-select" style={{ width: 110 }} value={mesSel} onChange={e => setMesSel(+e.target.value)}>
              {MONTH_NAMES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
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
          {/* KPIs do período em foco */}
          <div className="metrics-grid mb-6" style={telaCheia ? { display: 'none' } : undefined}>
            {[
              { label: 'Receita Bruta', value: foco.receitaBruta },
              { label: 'Margem de Contribuição', value: foco.margemContribuicao, sub: pct(foco.margemContribuicao, foco.receitaBruta) },
              { label: 'Lucro Operacional', value: foco.lucroOperacional, sub: pct(foco.lucroOperacional, foco.receitaBruta) },
              { label: 'EBITDA', value: foco.ebitda, sub: pct(foco.ebitda, foco.receitaBruta) },
              { label: 'Lucro Líquido Gerencial', value: foco.lucroLiquido, sub: pct(foco.lucroLiquido, foco.receitaBruta) },
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

          {unitId && rateio && !telaCheia && (
            <div className="card mb-6" style={{ padding: '12px 20px', background: '#e8f0fe', border: '1px solid #a8c7fa' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a5fa8' }}>
                ℹ Receita de {unitLabel} é rateada
              </span>
              <div style={{ fontSize: 12, color: '#1a5fa8', marginTop: 4 }}>
                Os recebimentos chegam consolidados, sem separação por loja. Custos e despesas
                abaixo são <strong>reais</strong> desta unidade; a receita é a receita total do mês
                multiplicada pela participação da loja
                {rateio.metodo === 'faturamento' && ' no faturamento do mês (aba Base_Vendas)'}
                {rateio.metodo === 'cmv' && ' no CMV do mês, por não haver faturamento informado'}
                {rateio.metodo === 'misto' && ' no faturamento do mês, e no CMV nos meses sem faturamento informado'}
                {rateio.metodo === 'sem-base' && ', mas não há base de rateio para esta unidade — é um centro de custo, aparece só com despesas'}
                . É a mesma regra da planilha.
              </div>
            </div>
          )}

          {foco.aClassificar > 0 && !telaCheia && (
            <div className="card mb-6" style={{ padding: '12px 20px', background: '#fffbea', border: '1px solid #f0c040' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#7a5c00' }}>
                ⚠ R$ {fmt(foco.aClassificar)} em contas ainda não classificadas
                {visao === 'mes' ? ` em ${MONTH_NAMES[mesSel]}` : ' no ano'}
              </span>
              <span style={{ fontSize: 12, color: '#7a5c00', marginLeft: 8 }}>
                — fora do resultado. Ajuste a categoria em Plano de Contas.
              </span>
            </div>
          )}

          {/* ── Tabela ─────────────────────────────────────────────── */}
          <div className="card mb-6" style={telaCheia
            ? { padding: 0, overflow: 'hidden', margin: '0 -32px', borderRadius: 0, borderLeft: 'none', borderRight: 'none' }
            : { padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--brave-light)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>
                  Demonstração do Resultado Gerencial — {visao === 'mes' ? `${MONTH_NAMES[mesSel]}/${year}` : year} · {unitLabel}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  {visao === 'mes'
                    ? 'Valores em R$ e participação sobre a receita bruta do mês'
                    : 'Valores em R$ · clique no + do mês para abrir a análise vertical'}
                  {mesesComDado.length > 0 && ` · dados de ${MONTH_NAMES[primeiroMes + 1]} a ${MONTH_NAMES[ultimoMes + 1]}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {visao === 'ano' && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAvAbertos(avAbertos.length > 0 ? [] : mesesComDado)}
                  >
                    {avAbertos.length > 0 ? '− Fechar AV%' : '+ AV% em todos os meses'}
                  </button>
                )}
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
              {visao === 'ano' ? (
                <table style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0, minWidth: 1180 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3, minWidth: 300, borderRight: '2px solid var(--brave-light)' }}>
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
                    {linhasAno.map((linha, i) => {
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
              ) : (
                /* Mês específico — a DRE clássica em uma coluna */
                <table style={{ fontSize: 12.5, borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, textAlign: 'left', minWidth: 420 }}>Conta</th>
                      <th style={{ ...TH, minWidth: 150 }}>{MONTH_NAMES[mesSel]}/{year}</th>
                      <th style={{ ...TH, minWidth: 90, background: '#f8fafb' }}>AV %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {linhasMes.map((linha: any, i: number) => {
                      const estilo = rowStyle(linha.type, linha.indent)
                      const cabecalhoMemo = linha.type === 'memo' && linha.indent === 0
                      return (
                        <tr key={i} style={estilo}>
                          <td style={{ ...labelStyle(linha.type, linha.indent), padding: '8px 12px', paddingLeft: 14 + linha.indent * 18 }}>
                            {linha.label}
                            {linha.sublabel && (
                              <span style={{ fontSize: 10, color: 'var(--brave-gray)', marginLeft: 6 }}>{linha.sublabel}</span>
                            )}
                          </td>
                          <td style={{
                            textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap',
                            color: valorCor(linha.type, linha.value),
                            fontWeight: linha.type === 'subtotal' ? 700 : undefined,
                          }}>
                            {cabecalhoMemo || linha.value === 0 ? '—' : fmt(linha.value)}
                          </td>
                          <td style={{
                            textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap',
                            background: '#f8fafb', fontSize: 11.5,
                            color: linha.type === 'subtotal' ? valorCor(linha.type, linha.value) : 'var(--brave-gray-mid)',
                            fontWeight: linha.type === 'subtotal' ? 700 : undefined,
                          }}>
                            {cabecalhoMemo || linha.value === 0 ? '—' : pct(linha.value, mesAtual?.receitaBruta ?? 0)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Ponto de equilíbrio, calculado mês a mês ───────────── */}
          <div className="card" style={telaCheia ? { display: 'none', padding: 0 } : { padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--brave-light)' }}>
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>
                Pontos de Equilíbrio mês a mês — {year} · {unitLabel}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                Receita mínima para zerar o resultado em cada nível. Cada mês tem a sua conta, porque
                custos fixos e margem de contribuição mudam de um mês para o outro ·
                <span style={{ color: '#1a7a4a', fontWeight: 600 }}> verde</span> = a receita do mês cobriu ·
                <span style={{ color: '#c0392b', fontWeight: 600 }}> vermelho</span> = não cobriu
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0, minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3, minWidth: 260, borderRight: '2px solid var(--brave-light)' }}>
                      Indicador
                    </th>
                    {MONTH_NAMES.slice(1).map((m, i) => (
                      <th key={m} style={{
                        ...TH, minWidth: 92,
                        color: mesesComDado.indexOf(i) >= 0 ? 'var(--brave-dark)' : 'var(--brave-gray)',
                        background: visao === 'mes' && i + 1 === mesSel ? 'rgba(234,202,45,0.18)' : 'var(--brave-white)',
                      }}>{m}</th>
                    ))}
                    <th style={{ ...TH, minWidth: 112, borderLeft: '2px solid var(--brave-light)' }}>Ano</th>
                  </tr>
                </thead>
                <tbody>
                  {LINHAS_PE.map(linha => (
                    <tr key={linha.label} style={linha.destaque ? { background: 'var(--brave-light)' } : undefined}>
                      <td style={{
                        position: 'sticky', left: 0, zIndex: 1,
                        background: linha.destaque ? 'var(--brave-light)' : 'var(--brave-white)',
                        borderRight: '2px solid var(--brave-light)',
                        padding: '8px 12px', whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-sub)', fontWeight: linha.destaque ? 700 : 600, fontSize: 12,
                      }}>
                        {linha.label}
                        {linha.hint && (
                          <span style={{ fontSize: 10, color: 'var(--brave-gray)', fontWeight: 400, marginLeft: 6 }}>
                            {linha.hint}
                          </span>
                        )}
                      </td>
                      {meses.map((d, i) => {
                        const v = linha.valor(d)
                        const semDado = mesesComDado.indexOf(i) < 0 || d.mcPct <= 0
                        const atingido = linha.pe ? d.receitaBruta >= v && v > 0 : false
                        return (
                          <td key={i} style={{
                            textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap',
                            background: visao === 'mes' && i + 1 === mesSel ? 'rgba(234,202,45,0.12)' : undefined,
                            color: semDado ? 'var(--brave-gray)'
                              : linha.pe ? (atingido ? '#1a7a4a' : '#c0392b')
                                : linha.tipo === 'pct' && v < 0 ? '#c0392b' : 'var(--brave-dark)',
                            fontWeight: linha.destaque ? 700 : undefined,
                          }}>
                            {semDado ? '—'
                              : linha.tipo === 'pct' ? `${v.toFixed(1)}%`
                                : fmt(v)}
                            {linha.pe && !semDado && (
                              <span style={{ marginLeft: 4, fontSize: 10 }}>{atingido ? '✓' : '✗'}</span>
                            )}
                          </td>
                        )
                      })}
                      <td style={{
                        textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap',
                        borderLeft: '2px solid var(--brave-light)', fontWeight: 700,
                        color: linha.pe
                          ? (anual.receitaBruta >= linha.valor(anual) ? '#1a7a4a' : '#c0392b')
                          : 'var(--brave-dark)',
                      }}>
                        {anual.mcPct > 0
                          ? (linha.tipo === 'pct' ? `${linha.valor(anual).toFixed(1)}%` : fmt(linha.valor(anual)))
                          : '—'}
                      </td>
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
