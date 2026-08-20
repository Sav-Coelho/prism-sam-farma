'use client'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: '◈', label: 'Dashboard' },
  { href: '/lancamentos', icon: '↑↓', label: 'Lançamentos' },
  { href: '/dre', icon: '▦', label: 'DRE' },
]

const NAV_CONFIG = [
  { href: '/plano-de-contas', icon: '≡', label: 'Plano de Contas' },
  { href: '/unidades', icon: '🏢', label: 'Unidades' },
]

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const item = (n: { href: string; icon: string; label: string }) => (
    <button
      key={n.href}
      className={`sidebar-item ${pathname.startsWith(n.href) ? 'active' : ''}`}
      onClick={() => router.push(n.href)}
    >
      <span className="sidebar-icon">{n.icon}</span>
      {n.label}
    </button>
  )

  return (
    <>
      <header className="topbar">
        <div className="topbar-logo">
          <span>Prism <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>· Sam Farma</span></span>
        </div>
        <div className="topbar-right">
          <span className="topbar-badge">v1.0</span>
        </div>
      </header>

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

      <main className="main">
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
