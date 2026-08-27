'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { ACCOUNT_TYPES, ALL_DRE_GROUPS, CAT, DRE_GROUPS } from '@/lib/dre'

interface Account {
  id: number
  code: string
  name: string
  erpKey: string | null
  type: string
  dreGroup: string
}

export default function PlanoDeContas() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [form, setForm] = useState({ code: '', name: '', type: 'DESPESA', dreGroup: CAT.ADMIN })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [busca, setBusca] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)

  const load = () =>
    fetch('/api/accounts').then(r => r.json()).then(d => { setAccounts(d); setLoading(false) })

  useEffect(() => { load() }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { showToast('Código e nome são obrigatórios'); return }
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    if (res.ok) {
      setForm({ code: '', name: '', type: 'DESPESA', dreGroup: CAT.ADMIN })
      load()
      showToast('✓ Conta criada')
    } else {
      const err = await res.json()
      showToast(err.error || 'Erro ao criar conta')
    }
  }

  const updateGroup = async (acc: Account, dreGroup: string) => {
    const type = ACCOUNT_TYPES.find(t => DRE_GROUPS[t].indexOf(dreGroup) >= 0) || acc.type
    setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, dreGroup, type } : a))
    const res = await fetch(`/api/accounts/${acc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dreGroup, type })
    })
    if (!res.ok) { showToast('Erro ao atualizar conta'); load() }
    else showToast('✓ ' + acc.name + ' → ' + dreGroup)
  }

  const remove = async (acc: Account) => {
    if (!confirm(`Remover a conta "${acc.name}"?`)) return
    const res = await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    load()
    showToast('Conta removida')
  }

  const pendentes = accounts.filter(a => a.dreGroup === CAT.A_CLASSIFICAR)

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return accounts
      .filter(a => !soPendentes || a.dreGroup === CAT.A_CLASSIFICAR)
      .filter(a => !termo
        || a.name.toLowerCase().includes(termo)
        || a.code.toLowerCase().includes(termo)
        || (a.erpKey || '').toLowerCase().includes(termo)
        || a.dreGroup.toLowerCase().includes(termo))
      .sort((a, b) => {
        // "A Classificar" primeiro — é o que precisa de ação
        const pa = a.dreGroup === CAT.A_CLASSIFICAR ? 0 : 1
        const pb = b.dreGroup === CAT.A_CLASSIFICAR ? 0 : 1
        return pa !== pb ? pa - pb : a.code.localeCompare(b.code)
      })
  }, [accounts, busca, soPendentes])

  const typeBadge = (type: string) => ({
    RECEITA: 'badge-receita', CUSTO: 'badge-custo', DESPESA: 'badge-despesa',
    DEDUCAO: 'badge-deducao', IMPOSTO: 'badge-imposto', NEUTRO: 'badge-neutro',
  } as Record<string, string>)[type] || ''

  const porCategoria = ALL_DRE_GROUPS.map(g => ({ g, n: accounts.filter(a => a.dreGroup === g).length }))
    .filter(x => x.n > 0)

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Plano de Contas · De-Para</h1>
          <p className="page-subtitle">
            Cada conta do ERP aponta para uma categoria da DRE. Conta nova entra como “A Classificar” até você definir.
          </p>
        </div>
      </div>

      {pendentes.length > 0 && (
        <div className="card mb-6" style={{ padding: '14px 20px', background: '#fffbea', border: '1px solid #f0c040' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7a5c00', marginBottom: 4 }}>
            ⚠ {pendentes.length} conta(s) aguardando classificação
          </div>
          <div style={{ fontSize: 12, color: '#7a5c00' }}>
            Enquanto estiverem em “A Classificar”, os valores aparecem no memo da DRE e ficam fora do resultado.
            Use o seletor de categoria na tabela abaixo.
          </div>
        </div>
      )}

      <div className="grid-2 mb-6">
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
            Nova conta manual
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
            As contas do ERP entram sozinhas na importação — use este formulário só para lançamentos avulsos.
          </div>
          <div className="form-group">
            <label className="form-label">Código</label>
            <input className="form-input" placeholder="ex: 5.1.01" value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Nome da conta</label>
            <input className="form-input" placeholder="ex: Aluguel Goiana" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Categoria na DRE</label>
            <select className="form-select" value={form.dreGroup}
              onChange={e => {
                const g = e.target.value
                const t = ACCOUNT_TYPES.find(x => DRE_GROUPS[x].indexOf(g) >= 0) || 'DESPESA'
                setForm(f => ({ ...f, dreGroup: g, type: t }))
              }}>
              {ALL_DRE_GROUPS.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
            + Adicionar conta
          </button>

          <div style={{ marginTop: 24 }}>
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12, marginBottom: 10 }}>
              Contas por categoria
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {porCategoria.map(({ g, n }) => (
                <div key={g} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: g === CAT.A_CLASSIFICAR ? '#fffbea' : 'var(--brave-light)', borderRadius: 6 }}>
                  <span style={{ color: g === CAT.A_CLASSIFICAR ? '#7a5c00' : undefined }}>{g}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
              {visiveis.length} de {accounts.length} contas
            </span>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '6px 10px' }}
              placeholder="Buscar por nome, código ou caminho do ERP..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} />
              só a classificar
            </label>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
          ) : visiveis.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              Nenhuma conta encontrada.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Conta</th>
                    <th>Categoria na DRE</th>
                    <th>Tipo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.slice(0, 300).map(a => (
                    <tr key={a.id} style={{ background: a.dreGroup === CAT.A_CLASSIFICAR ? '#fffbea' : undefined }}>
                      <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{a.code}</td>
                      <td style={{ fontSize: 13, maxWidth: 260 }}>
                        {a.name}
                        {a.erpKey && (
                          <div style={{ fontSize: 10, color: 'var(--brave-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={a.erpKey}>
                            {a.erpKey}
                          </div>
                        )}
                      </td>
                      <td>
                        <select
                          className="form-select"
                          style={{ fontSize: 11, padding: '4px 6px', minWidth: 190 }}
                          value={a.dreGroup}
                          onChange={e => updateGroup(a, e.target.value)}
                        >
                          {ALL_DRE_GROUPS.map(g => <option key={g}>{g}</option>)}
                        </select>
                      </td>
                      <td><span className={`badge ${typeBadge(a.type)}`}>{a.type}</span></td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visiveis.length > 300 && (
                <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--brave-gray)' }}>
                  Mostrando 300 de {visiveis.length} — refine a busca.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
