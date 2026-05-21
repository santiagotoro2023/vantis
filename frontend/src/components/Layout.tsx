import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Brain, MessageSquare, Target, Settings, Users, Terminal, Activity, LogOut, Wifi, Zap, Download, FileText, Moon, Sun, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'
import VantisLogo from './VantisLogo'
import NotificationHistory from './NotificationHistory'

interface Props {
  children: React.ReactNode
  role?: string
  notification?: string | null
}

const NAV = [
  { to: '/brain', icon: Brain, label: 'Brain', key: 'B' },
  { to: '/chat', icon: MessageSquare, label: 'Chat', key: 'C' },
  { to: '/monologue', icon: Activity, label: 'Monologue', key: 'M' },
  { to: '/goals', icon: Target, label: 'Goals', key: 'G' },
  { to: '/skills', icon: Zap, label: 'Skills', key: 'S' },
  { to: '/sandbox', icon: Terminal, label: 'Sandbox', key: '' },
]

const ADMIN_NAV = [
  { to: '/admin/network', icon: Wifi, label: 'Network' },
  { to: '/admin/personality', icon: Settings, label: 'Personality' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/update', icon: Download, label: 'Update' },
  { to: '/admin/reports', icon: FileText, label: 'Reports' },
]

// 5 most important nav items for mobile bottom bar
const MOBILE_NAV = [
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/brain', icon: Brain, label: 'Brain' },
  { to: '/goals', icon: Target, label: 'Goals' },
  { to: '/skills', icon: Zap, label: 'Skills' },
  { to: '/admin/personality', icon: Settings, label: 'Admin' },
]

export default function Layout({ children, role, notification }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()
  const [dim, setDim] = useState(() => localStorage.getItem('vantis_theme') === 'dim')

  const toggleTheme = () => {
    const next = !dim
    setDim(next)
    document.documentElement.classList.toggle('theme-dim', next)
    localStorage.setItem('vantis_theme', next ? 'dim' : 'dark')
  }

  // Apply saved theme on mount
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('theme-dim', dim)
  }

  const logout = () => {
    localStorage.removeItem('vantis_token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-void overflow-hidden">
      {/* Sidebar — desktop only */}
      <nav className="hidden md:flex w-14 bg-surface border-r border-border flex-col items-center py-3 gap-0.5 shrink-0 relative">
        {/* Amber top accent line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-accent opacity-60" />

        {/* VANTIS logo */}
        <div className="mb-3 mt-1 flex flex-col items-center">
          <Link to="/brain" title="VANTIS">
            <VantisLogo size={36} animated />
          </Link>
          <div className="w-4 h-px bg-accent/40 mt-1" />
        </div>

        {NAV.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            title={label}
            className={clsx(
              'p-2.5 transition-all relative group',
              loc.pathname.startsWith(to)
                ? 'text-accent'
                : 'text-muted hover:text-text'
            )}
          >
            {loc.pathname.startsWith(to) && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent" />
            )}
            <Icon size={16} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-surface border border-border text-xs text-text
                            whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {label}
            </div>
          </Link>
        ))}

        {role === 'administrator' && (
          <>
            <div className="w-6 h-px bg-border/60 my-1" />
            {ADMIN_NAV.map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                title={label}
                className={clsx(
                  'p-2.5 transition-all relative group',
                  loc.pathname.startsWith(to)
                    ? 'text-accent'
                    : 'text-muted hover:text-text'
                )}
              >
                {loc.pathname.startsWith(to) && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent" />
                )}
                <Icon size={16} />
                <div className="absolute left-full ml-2 px-2 py-1 bg-surface border border-border text-xs text-text
                                whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {label}
                </div>
              </Link>
            ))}
          </>
        )}

        <div className="mt-auto flex flex-col items-center">
          <button
            onClick={toggleTheme}
            title={dim ? 'Switch to dark mode' : 'Switch to dim mode'}
            className="p-2.5 text-muted hover:text-accent transition-colors"
          >
            {dim ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            to="/settings"
            title="Settings"
            className={`p-2.5 transition-all relative group ${loc.pathname === '/settings' ? 'text-accent' : 'text-muted hover:text-text'}`}
          >
            <SlidersHorizontal size={16} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-surface border border-border text-xs text-text
                            whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              Settings
            </div>
          </Link>
          <NotificationHistory />
          <button
            onClick={logout}
            title="Terminate session"
            className="p-2.5 text-muted hover:text-danger transition-colors"
          >
            <LogOut size={16} />
          </button>
          {/* Keyboard shortcut hints */}
          <div className="mt-2 mb-1 text-[7px] font-mono text-muted/30 tracking-widest text-center leading-relaxed select-none">
            C·B·G<br/>S·M
          </div>
        </div>

        {/* Bottom accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {notification && (
          <div className="border-b border-accent/40 bg-accent/5 px-4 py-2 text-xs text-accent font-mono
                          flex items-center gap-2 hazard-stripe">
            <span className="text-accent font-bold shrink-0">VANTIS</span>
            <span className="text-text">{notification}</span>
          </div>
        )}
        <main className="flex-1 overflow-auto pb-14 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-surface z-50">
        {MOBILE_NAV.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className={clsx(
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors',
              loc.pathname.startsWith(to)
                ? 'text-accent'
                : 'text-muted hover:text-text'
            )}
          >
            <Icon size={18} />
            <span className="text-[9px] font-mono tracking-wider">{label.toUpperCase()}</span>
          </Link>
        ))}
        <button
          onClick={logout}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-muted hover:text-danger transition-colors"
        >
          <LogOut size={18} />
          <span className="text-[9px] font-mono tracking-wider">OUT</span>
        </button>
      </nav>
    </div>
  )
}
