/**
 * CrateForge V2 — Tailwind mappato sui token di ruolo definiti in index.css.
 * Nessun colore letterale qui dentro: solo `rgb(var(--token) / <alpha-value>)`,
 * così ogni utility funziona identica nelle quattro palette.
 *
 * @type {import('tailwindcss').Config}
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: {
          1: token('surface-1'),
          2: token('surface-2'),
          3: token('surface-3'),
          hover: token('surface-hover'),
          expert: token('sidebar-expert')
        },
        line: {
          subtle: token('line-subtle'),
          DEFAULT: token('line'),
          strong: token('line-strong')
        },
        ink: {
          hi: token('text-hi'),
          mid: token('text-mid'),
          lo: token('text-lo'),
          disabled: token('text-disabled')
        },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          ink: token('accent-ink')
        },
        warning: {
          DEFAULT: token('warning'),
          ink: token('warning-ink')
        },
        destructive: {
          DEFAULT: token('destructive'),
          ink: token('destructive-ink')
        },
        success: {
          DEFAULT: token('success'),
          ink: token('success-ink')
        },
        /* Tinte dei cue: fisse in tutte le palette, desaturate per restare
           distinguibili anche in scala di grigi (§5.1). */
        cue: {
          intro: '#6C9BC9',
          build: '#5E9E72',
          drop: '#E8912E',
          breakdown: '#8F8AC4',
          drop2: '#C4776B',
          outro: '#7FA8A0',
          loop: '#B9A06B',
          other: '#8A9099'
        }
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      /* Sei ruoli tipografici, niente in mezzo (§1.5). */
      fontSize: {
        display: ['40px', { lineHeight: '44px', letterSpacing: '-0.03em', fontWeight: '600' }],
        title: ['24px', { lineHeight: '30px', letterSpacing: '-0.02em', fontWeight: '600' }],
        section: ['15px', { lineHeight: '20px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '19px' }],
        caption: ['11.5px', { lineHeight: '16px' }],
        eyebrow: ['11px', { lineHeight: '14px', letterSpacing: '0.14em', fontWeight: '500' }],
        data: ['12.5px', { lineHeight: '16px', fontWeight: '500' }],
        'data-lg': ['27px', { lineHeight: '30px', fontWeight: '500', letterSpacing: '-0.02em' }],
        'data-xl': ['44px', { lineHeight: '46px', fontWeight: '500', letterSpacing: '-0.03em' }]
      },
      borderRadius: {
        chip: '4px',
        control: '6px',
        card: '10px',
        dialog: '14px'
      },
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)'
      },
      spacing: {
        sidebar: '252px',
        'sidebar-collapsed': '68px',
        topbar: '54px',
        jobbar: '46px',
        statusbar: '30px',
        row: 'var(--row-h)'
      },
      transitionTimingFunction: {
        swift: 'cubic-bezier(.2,0,0,1)'
      },
      transitionDuration: {
        press: '120ms',
        swap: '180ms',
        route: '220ms',
        theme: '240ms',
        dialog: '280ms'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        sweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } }
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-up': 'slide-up 220ms cubic-bezier(.2,0,0,1)',
        'scale-in': 'scale-in 280ms cubic-bezier(.2,0,0,1)',
        sweep: 'sweep 1.15s ease-in-out infinite'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};
