/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#080a0f',
        surface: '#0d1117',
        panel: '#161b22',
        border: '#21262d',
        accent: '#6366f1',
        'accent-glow': '#818cf8',
        thought: '#6366f1',
        memory: '#10b981',
        goal: '#f59e0b',
        conversation: '#3b82f6',
        danger: '#ef4444',
        muted: '#8b949e',
        text: '#e6edf3',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #6366f1' },
          '100%': { boxShadow: '0 0 20px #6366f1, 0 0 40px #6366f188' },
        },
      },
    },
  },
  plugins: [],
}
