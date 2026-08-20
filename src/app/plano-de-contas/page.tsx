'use client'
import { useEffect, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { ACCOUNT_TYPES, ALL_DRE_GROUPS, DRE_GROUPS } from '@/lib/dre'

interface Account {
  id: number
  code: string
  name: string
  type: string
  dreGroup: string
}

const TEMPLATE_CSV = [
  'Código;Nome da Conta;Tipo;Grupo DRE',
  '3.1.01;Vendas Balcão;RECEITA;Receita Operacional',
  '3.2.01;Tarifas de Cartões (MDR);DEDUCAO;Deduções sobre a Venda',
  '4.1.01;Compras de Medicamentos;CUSTO;Custo do Produto/Serviço',
  '5.1.01;Aluguel;DESPESA;Despesas Administrativas',
  '5.3.01;Salários;DESPESA;Despesas com Pessoal',
  '8.1.01;Simples Nacional;IMPOSTO;Impostos',
].join('\n')

export default function PlanoDeContas() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [form, setForm] = useState({ code: '', name: '', type: 'RECEITA', dreGroup: 'Receita Operacional' })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const importRef = useRef<HTMLInputElement>(null)

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
      setForm({ code: '', name: '', type: 'RECEITA', dreGroup: 'Receita Operacional' })
      load()
      showToast('✓ Conta criada')
    } else {
      const err = await res.json()
      showToast(err.error || 'Erro ao criar conta')
    }
  }

  const updateGroup = async (acc: Account, dreGroup: string) => {
    // O tipo acompanha o grupo escolhido (um grupo pertence a um único tipo)
    const type = ACCOUNT_TYPES.find(t => DRE_GROUPS[t].includes(dreGroup)) || acc.type
    setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, dreGroup, type } : a))
    const res = await fetch(`/api/accounts/${acc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dreGroup, type })
    })
    if (!res.ok) { showToast('Erro ao atualizar conta'); load() }
  }

  const remove = async (acc: Account) => {
    if (!confirm(`Remover a conta "${acc.name}"?`)) return
    const res = await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    load()
    showToast('Conta removida')
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    setImportErrors([])
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/accounts/import', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) {
      await load()
      const parts = [`${data.imported} criadas`, `${data.updated} atualizadas`]
      if (data.errors?.length) parts.push(`${data.errors.length} não reconhecidas`)
      setImportErrors(data.errors || [])
      showToast(`✓ ${parts.join(', ')}`)
    } else {
      showToast(`Erro: ${data.error}`)
    }
    setImporting(false)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-plano-de-contas.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const typeBadge = (type: string) => ({
    RECEITA: 'badge-receita', CUSTO: 'badge-custo', DESPESA: 'badge-despesa',
    DEDUCAO: 'badge-deducao', IMPOSTO: 'badge-imposto', NEUTRO: 'badge-neutro',
  } as Record<string, string>)[type] || ''

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Plano de Contas</h1>
          <p className="page-subtitle">Configure as contas que alimentam a DRE</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={importRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button className="btn btn-secondary btn-sm" onClick={downloadTemplate}>⬇ Modelo CSV</button>
          <button className="btn btn-primary" onClick={() => importRef.current?.click()} disabled={importing}>
            {importing ? 'Importando...' : '⬆ Importar Excel/CSV'}
          </button>
        </div>
      </div>

      <div className="card mb-6" style={{ padding: '14px 20px', background: '#f4f6fa' }}>
        <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', lineHeight: 1.7 }}>
          <strong>Formatos aceitos na importação:</strong> (1) planilha com colunas
          <em> Código · Nome · Tipo · Grupo DRE</em>; ou (2) coluna única com os grupos da DRE como
          cabeçalhos de seção (ex.: “Despesas Administrativas”) seguidos das contas — nesse caso o
          código é gerado automaticamente. Grupos válidos: {ALL_DRE_GROUPS.join(' · ')}.
        </div>
      </div>

      {importErrors.length > 0 && (
        <div className="card mb-6" style={{ padding: '12px 20px', background: '#fffbea', border: '1px solid #f0c040' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#7a5c00', marginBottom: 6 }}>
            Linhas não importadas ({importErrors.length})
          </div>
          <div style={{ fontSize: 11, color: '#7a5c00', maxHeight: 120, overflowY: 'auto' }}>
            {importErrors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        </div>
      )}

      <div className="grid-2 mb-6">
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
            Nova Conta
          </div>
          <div className="form-group">
            <label className="form-label">Código</label>
            <input className="form-input" placeholder="ex: 3.1.01" value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Nome da Conta</label>
            <input className="form-input" placeholder="ex: Vendas Balcão" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Tipo</label>
            <select className="form-select" value={form.type}
              onChange={e => {
                const t = e.target.value
                setForm(f => ({ ...f, type: t, dreGroup: DRE_GROUPS[t][0] }))
              }}>
              {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Grupo na DRE</label>
            <select className="form-select" value={form.dreGroup}
              onChange={e => setForm(f => ({ ...f, dreGroup: e.target.value }))}>
              {(DRE_GROUPS[form.type] || []).map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
            + Adicionar Conta
          </button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 12px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
            Contas Cadastradas ({accounts.length})
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
          ) : accounts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              Nenhuma conta cadastrada.<br />
              <span style={{ fontSize: 12 }}>Importe o plano de contas ou cadastre manualmente.</span>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nome</th>
                    <th>Grupo DRE</th>
                    <th>Tipo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12 }}>{a.code}</td>
                      <td style={{ fontSize: 13 }}>{a.name}</td>
                      <td>
                        <select
                          className="form-select"
                          style={{ fontSize: 11, padding: '4px 6px' }}
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
            </div>
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
            Estrutura do Plano de Contas
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {ACCOUNT_TYPES.map(t => {
              const count = accounts.filter(a => a.type === t).length
              return (
                <div key={t} style={{ background: 'var(--brave-light)', borderRadius: 8, padding: '12px 16px' }}>
                  <span className={`badge ${typeBadge(t)}`} style={{ marginBottom: 8, display: 'inline-block' }}>{t}</span>
                  <div style={{ fontFamily: 'var(--font-title)', fontSize: 22, fontWeight: 700 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{count === 1 ? 'conta' : 'contas'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
