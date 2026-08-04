/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dd: {
          purple: '#632ca6',
          'purple-dark': '#4a1d8f',
          'purple-light': '#8b5cf6',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f8f8fa',
          sunken: '#f1f1f5',
        },
        border: {
          DEFAULT: '#e4e4ea',
          strong: '#d3d3dc',
        },
        ink: {
          DEFAULT: '#16161d',
          muted: '#5c5c6b',
          faint: '#8b8b98',
        },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(16 16 24 / 0.04)',
        sm: '0 1px 3px 0 rgb(16 16 24 / 0.06), 0 1px 2px -1px rgb(16 16 24 / 0.04)',
        md: '0 4px 12px -2px rgb(16 16 24 / 0.08), 0 2px 4px -2px rgb(16 16 24 / 0.04)',
        lg: '0 12px 24px -6px rgb(16 16 24 / 0.12), 0 4px 8px -4px rgb(16 16 24 / 0.06)',
        popover: '0 8px 24px -4px rgb(16 16 24 / 0.16), 0 0 0 1px rgb(16 16 24 / 0.04)',
      },
      fontSize: {
        display: ['1.75rem', { lineHeight: '2.1rem', fontWeight: '700', letterSpacing: '-0.01em' }],
        heading: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        caption: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }],
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 120ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'scale-in': { from: { opacity: 0, transform: 'scale(0.96)' }, to: { opacity: 1, transform: 'scale(1)' } },
        'slide-in-right': { from: { transform: 'translateX(16px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
        'slide-in-left': { from: { transform: 'translateX(-16px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
      },
    },
  },
  plugins: [],
};
