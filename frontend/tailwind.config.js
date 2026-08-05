/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cool slate scale — unchanged; already the same family as the new
        // charcoal background, so gray-* utilities stay consistent with it.
        gray: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        white: '#ffffff',
        // Secondary/AI accent — kept distinct from the primary emerald but
        // deliberately desaturated (teal, not violet/indigo) so the palette
        // still reads as "one intentional accent + neutrals," not two brands.
        violet: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
        },
        // Primary accent — emerald, repainting every existing dd-purple/sun
        // usage across the app (buttons, links, focus rings, active nav).
        dd: {
          purple: '#10b981',
          'purple-dark': '#059669',
          'purple-light': '#34d399',
        },
        // Deep charcoal surfaces, three tiers: page bg, raised panel, recessed well.
        surface: {
          DEFAULT: '#0f172a',
          subtle: '#141c2e',
          sunken: '#0a0f1c',
        },
        border: {
          DEFAULT: '#1e293b',
          strong: '#334155',
        },
        // Text colors — crisp near-white primary, slate-400/500 for muted tiers.
        ink: {
          DEFAULT: '#f1f5f9',
          muted: '#94a3b8',
          faint: '#64748b',
        },
        sun: {
          DEFAULT: '#10b981',
          light: '#34d399',
          dark: '#059669',
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        // Dark-surface shadows lean on deeper black + a faint top highlight
        // rather than light-mode's soft gray blur, which disappears on a dark bg.
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.3)',
        sm: '0 1px 3px 0 rgb(0 0 0 / 0.4), 0 1px 2px -1px rgb(0 0 0 / 0.3)',
        md: '0 4px 16px -2px rgb(0 0 0 / 0.45), 0 2px 4px -2px rgb(0 0 0 / 0.3)',
        lg: '0 16px 32px -8px rgb(0 0 0 / 0.55), 0 4px 8px -4px rgb(0 0 0 / 0.35)',
        popover: '0 12px 32px -4px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.05)',
        glow: '0 0 0 1px rgb(16 185 129 / 0.25), 0 0 24px -4px rgb(16 185 129 / 0.35)',
      },
      fontSize: {
        display: ['2.25rem', { lineHeight: '1.08', fontWeight: '900', letterSpacing: '-0.02em' }],
        heading: ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '700', letterSpacing: '-0.005em' }],
        caption: ['0.75rem', { lineHeight: '1rem', fontWeight: '500', letterSpacing: '0.01em' }],
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
