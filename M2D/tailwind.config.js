/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        // M2D dark navy palette
        navy: {
          950: '#020817',
          900: '#0a0f1e',
          800: '#0d1530',
          700: '#111d42',
          600: '#162354',
          500: '#1e3a8a',
        },
        cyan: {
          glow: '#00e5ff',
        },
        signal: {
          long:  '#00e676',
          short: '#ff1744',
          flat:  '#546e7a',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4,0,0.6,1) infinite',
      }
    }
  },
  plugins: []
}
