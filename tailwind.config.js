/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        dim: 'var(--dim)',
        accent: 'var(--accent)',
        accent2: 'var(--accent2)',
        line: 'var(--line)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '28px',
      },
      keyframes: {
        floatY: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        eq: { '0%,100%': { height: '4px' }, '50%': { height: '16px' } },
      },
      animation: {
        floatY: 'floatY 6s ease-in-out infinite',
        spinSlow: 'spinSlow 8s linear infinite',
        pulseDot: 'pulseDot 1.4s ease-in-out infinite',
        fadeUp: 'fadeUp 0.7s ease forwards',
      },
    },
  },
  plugins: [],
};
