'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: '◈', label: 'Dashboard' },
  { href: '/lancamentos', icon: '↑↓', label: 'Lançamentos' },
  { href: '/dre', icon: '▦', label: 'DRE' },
  { href: '/fluxo-projetado', icon: '📅', label: 'Fluxo Projetado' },
]

const NAV_CONFIG = [
  { href: '/plano-de-contas', icon: '≡', label: 'Plano de Contas' },
  { href: '/unidades', icon: '🏢', label: 'Unidades' },
]

const CHAVE = 'sf-menu-colapsado'
/** Evento que as páginas disparam para colapsar o menu (ex.: a DRE em tela cheia). */
export const EVENTO_MENU = 'sf-menu'

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [colapsado, setColapsado] = useState(false)

  useEffect(() => {
    try {
      setColapsado(localStorage.getItem(CHAVE) === '1')
    } catch { /* modo privado */ }
    const ouvir = (e: Event) => {
      const alvo = (e as CustomEvent<boolean>).detail
      setColapsado(alvo)
      try { localStorage.setItem(CHAVE, alvo ? '1' : '0') } catch { /* ignore */ }
    }
    window.addEventListener(EVENTO_MENU, ouvir)
    return () => window.removeEventListener(EVENTO_MENU, ouvir)
  }, [])

  const alternar = () => {
    const alvo = !colapsado
    setColapsado(alvo)
    try { localStorage.setItem(CHAVE, alvo ? '1' : '0') } catch { /* ignore */ }
  }

  const item = (n: { href: string; icon: string; label: string }) => (
    <button
      key={n.href}
      className={`sidebar-item ${pathname.startsWith(n.href) ? 'active' : ''}`}
      onClick={() => router.push(n.href)}
      title={n.label}
    >
      <span className="sidebar-icon">{n.icon}</span>
      {n.label}
    </button>
  )

  return (
    <>
      <header className="topbar">
        <button
          onClick={alternar}
          title={colapsado ? 'Mostrar menu' : 'Esconder menu'}
          style={{
            background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
            borderRadius: 6, width: 30, height: 30, fontSize: 15, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {colapsado ? '☰' : '⟨'}
        </button>
        <div className="topbar-logo">
          <span>Prism <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>· Sam Farma</span></span>
        </div>
        <div className="topbar-right">
          <span className="topbar-badge">v1.0</span>
        </div>
      </header>

      {!colapsado && (
        <nav className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Menu</div>
            {NAV.map(item)}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-label">Configuração</div>
            {NAV_CONFIG.map(item)}
          </div>
        </nav>
      )}

      <main className="main" style={colapsado ? { marginLeft: 0 } : undefined}>
        {children}
        <footer style={{
          marginTop: 48,
          paddingTop: 16,
          borderTop: '1px solid #e0e0e0',
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--brave-gray)',
          letterSpacing: '0.03em',
        }}>
          Desenvolvido por Delfos Research LTDA — Uso Restrito
        </footer>
      </main>
    </>
  )
}
