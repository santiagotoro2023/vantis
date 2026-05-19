import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Brain, MessageSquare, Target, Settings, Users, Terminal, Activity, LogOut } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  children: React.ReactNode
  role?: string
  notification?: string | null
}

const NAV = [
  { to: '/brain', icon: Brain, label: 'Brain' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/monologue', icon: Activity, label: 'Monologue' },
  { to: '/goals', icon: Target, label: 'Goals' },
  { to: '/sandbox', icon: Terminal, label: 'Sandbox' },
]

const ADMIN_NAV = [
  { to: '/admin/personality', icon: Settings, label: 'Personality' },
  { to: '/admin/users', icon: Users, label: 'Users' },
]

export default function Layout({ children, role, notification }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem('vantis_token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-void overflow-hidden">
      {/* Sidebar */}
      <nav className="w-14 bg-surface border-r border-border flex flex-col items-center py-4 gap-1 shrink-0">
        <div className="text-accent font-mono font-bold text-lg mb-4">V</div>
        {NAV.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            title={label}
            className={clsx(
              'p-3 rounded-lg transition-colors',
              loc.pathname.startsWith(to)
                ? 'bg-accent/20 text-accent'
                : 'text-muted hover:text-text hover:bg-panel'
            )}
          >
            <Icon size={18} />
          </Link>
        ))}
        {role === 'administrator' && (
          <>
            <div className="w-8 h-px bg-border my-2" />
            {ADMIN_NAV.map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                title={label}
                className={clsx(
                  'p-3 rounded-lg transition-colors',
                  loc.pathname.startsWith(to)
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted hover:text-text hover:bg-panel'
                )}
              >
                <Icon size={18} />
              </Link>
            ))}
          </>
        )}
        <div className="mt-auto">
          <button
            onClick={logout}
            title="Logout"
            className="p-3 rounded-lg text-muted hover:text-danger transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {notification && (
          <div className="bg-accent/10 border-b border-accent/30 px-4 py-2 text-sm text-accent-glow">
            {notification}
          </div>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
