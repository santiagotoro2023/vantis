import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function useKeyboardShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.key === 'c' || e.key === 'C') navigate('/chat')
      if (e.key === 'b' || e.key === 'B') navigate('/brain')
      if (e.key === 'g' || e.key === 'G') navigate('/goals')
      if (e.key === 's' || e.key === 'S') navigate('/skills')
      if (e.key === 'm' || e.key === 'M') navigate('/monologue')
      if (e.key === 'Escape') {
        // Close any open panels — emit a custom event
        window.dispatchEvent(new CustomEvent('vantis:escape'))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])
}
