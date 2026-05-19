/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core palette: pitch black with amber/red menace
        void:    '#030407',
        surface: '#080b10',
        panel:   '#0d1018',
        border:  '#1a1f2e',
        'border-hot': '#f59e0b44',
        // Primary accent: Aperture amber/yellow
        accent:       '#f59e0b',
        'accent-dim': '#d97706',
        'accent-glow':'#fbbf24',
        // Secondary: cold cyan (testing chamber blue)
        cyan:       '#22d3ee',
        'cyan-dim': '#0891b2',
        // Node type colors
        thought:      '#818cf8',  // violet
        memory:       '#34d399',  // emerald
        goal:         '#f59e0b',  // amber
        conversation: '#60a5fa',  // blue
        // Status
        danger:   '#ef4444',
        warning:  '#f59e0b',
        success:  '#10b981',
        // Text
        text:  '#d1d5db',
        'text-bright': '#f3f4f6',
        muted: '#6b7280',
        'muted-dim': '#374151',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-amber': 'glowAmber 2s ease-in-out infinite alternate',
        'glow-red': 'glowRed 1.5s ease-in-out infinite alternate',
        'scanline': 'scanline 8s linear infinite',
        'blink': 'blink 1s step-end infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        glowAmber: {
          '0%':   { boxShadow: '0 0 4px #f59e0b44' },
          '100%': { boxShadow: '0 0 16px #f59e0b99, 0 0 32px #f59e0b33' },
        },
        glowRed: {
          '0%':   { boxShadow: '0 0 4px #ef444444' },
          '100%': { boxShadow: '0 0 20px #ef4444aa, 0 0 40px #ef444433' },
        },
        scanline: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 24%, 55%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
}
