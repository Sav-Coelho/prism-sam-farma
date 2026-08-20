'use client'
import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'

type BankAccount = { id: number; name: string; initialBalance: number }
type Unit = { id: number; name: string; bankAccounts: BankAccount[] }

export default function Unidades() {
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  // Modal de unidade
  const [unitModal, setUnitModal] = useState(false)
  const [editUnit, setEditUnit] = useState<Unit | null>(null)
  const [unitName, setUnitName] = useState('')
  const [unitSaving, setUnitSaving] = useState(false)

  // Modal de conta bancária
  const [bankModal, setBankModal] = useState(false)
  const [editBank, setEditBank] = useState<BankAccount | null>(null)
  const [bankUnitId, setBankUnitId] = useState<number | null>(null)
  const [bankName, setBankName] = useState('')
  const [bankBalance, setBankBalance] = useState('')
  const [bankSaving, setBankSaving] = useState(false)

  const load = () =>
    fetch('/api/units').then(r => r.json()).then((d: Unit[]) => { setUnits(d); setLoading(false) })

  useEffect(() => { load() }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const openAddUnit = () => { setEditUnit(null); setUnitName(''); setUnitModal(true) }
  const openEditUnit = (u: Unit) => { setEditUnit(u); setUnitName(u.name); setUnitModal(true) }

  const saveUnit = async () => {
    if (!unitName.trim()) return
    setUnitSaving(true)
    const url = editUnit ? `/api/units/${editUnit.id}` : '/api/units'
    const res = await fetch(url, {
      method: editUnit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: unitName }),
    })
    const data = await res.json()
    setUnitSaving(false)
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setUnitModal(false)
    await load()
    showToast(editUnit ? '✓ Unidade atualizada' : '✓ Unidade criada')
  }

  const deleteUnit = async (u: Unit) => {
    if (!confirm(`Excluir a unidade "${u.name}"? As contas bancárias também serão excluídas.`)) return
    const res = await fetch(`/api/units/${u.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    await load()
    showToast('✓ Unidade excluída')
  }

  const openAddBank = (unitId: number) => {
    setEditBank(null); setBankUnitId(unitId); setBankName(''); setBankBalance(''); setBankModal(true)
  }
  const openEditBank = (bank: BankAccount, unitId: number) => {
    setEditBank(bank); setBankUnitId(unitId); setBankName(bank.name)
    setBankBalance(String(bank.initialBalance || '')); setBankModal(true)
  }

  const saveBank = async () => {
    if (!bankName.trim() || !bankUnitId) return
    setBankSaving(true)
    const url = editBank ? `/api/bank-accounts/${editBank.id}` : '/api/bank-accounts'
    const body = editBank
      ? { name: bankName, initialBalance: bankBalance }
      : { name: bankName, unitId: bankUnitId, initialBalance: bankBalance }
    const res = await fetch(url, {
      method: editBank ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setBankSaving(false)
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setBankModal(false)
    await load()
    showToast(editBank ? '✓ Conta atualizada' : '✓ Conta adicionada')
  }

  const deleteBank = async (bank: BankAccount) => {
    if (!confirm(`Excluir a conta "${bank.name}"?`)) return
    const res = await fetch(`/api/bank-accounts/${bank.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    await load()
    showToast('✓ Conta excluída')
  }

  const totalBanks = units.reduce((acc, u) => acc + u.bankAccounts.length, 0)

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Unidades</h1>
          <p className="page-subtitle">Unidades de negócio e suas contas bancárias</p>
        </div>
        <button className="btn btn-primary" onClick={openAddUnit}>+ Nova Unidade</button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : units.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600 }}>Nenhuma unidade cadastrada</div>
          <div style={{ fontSize: 13, color: 'var(--brave-gray)', marginTop: 6, marginBottom: 20 }}>
            Crie a primeira unidade (ex.: SAM FARMA) para começar a lançar.
          </div>
          <button className="btn btn-primary" onClick={openAddUnit}>+ Nova Unidade</button>
        </div>
      ) : (
        <>
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Unidades</div>
              <div className="metric-value">{units.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Contas Bancárias</div>
              <div className="metric-value">{totalBanks}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Status</div>
              <div className="metric-value" style={{ fontSize: 14, color: '#1a7a4a' }}>Ativo</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {units.map(unit => (
              <div key={unit.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 15 }}>
                    🏢 {unit.name}
                    <span style={{ fontSize: 11, color: 'var(--brave-gray)', fontWeight: 400, marginLeft: 8 }}>
                      {unit.bankAccounts.length} conta{unit.bankAccounts.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEditUnit(unit)}>✏️</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteUnit(unit)}>✕</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {unit.bankAccounts.map(bank => (
                    <div key={bank.id} style={{
                      background: 'var(--brave-light)', borderRadius: 6,
                      padding: '8px 12px', fontSize: 13,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <span>{bank.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {bank.initialBalance !== 0 && (
                          <span style={{ fontSize: 12, color: bank.initialBalance > 0 ? '#1a7a4a' : '#c0392b', fontWeight: 600 }}>
                            R$ {bank.initialBalance.toFixed(2)}
                          </span>
                        )}
                        <button className="btn btn-secondary btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => openEditBank(bank, unit.id)}>✏️</button>
                        <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => deleteBank(bank)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 10, width: '100%', fontSize: 12, justifyContent: 'center' }}
                  onClick={() => openAddBank(unit.id)}
                >
                  + Adicionar Conta Bancária
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal de unidade */}
      {unitModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 380, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16, fontSize: 15 }}>
              {editUnit ? 'Editar Unidade' : 'Nova Unidade'}
            </h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Nome</label>
            <input
              className="form-input"
              style={{ marginBottom: 16 }}
              placeholder="Ex: SAM FARMA, FILIAL CENTRO..."
              value={unitName}
              onChange={e => setUnitName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveUnit()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setUnitModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveUnit} disabled={unitSaving || !unitName.trim()}>
                {unitSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de conta bancária */}
      {bankModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 400, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16, fontSize: 15 }}>
              {editBank ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
            </h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Nome da Conta</label>
            <input
              className="form-input"
              style={{ marginBottom: 12 }}
              placeholder="Ex: ITAÚ 1234, CAIXA LOJA..."
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              autoFocus
            />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Saldo Inicial (R$)</label>
            <input
              className="form-input"
              style={{ marginBottom: 16 }}
              type="number"
              step="0.01"
              placeholder="0.00"
              value={bankBalance}
              onChange={e => setBankBalance(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setBankModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBank} disabled={bankSaving || !bankName.trim()}>
                {bankSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
