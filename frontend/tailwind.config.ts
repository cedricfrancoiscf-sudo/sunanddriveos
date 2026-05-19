import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Charte graphique Sun and Drive
        primary: {
          DEFAULT: '#01696e',
          dark: '#085659',
        },
        secondary: '#04292a',
        accent: '#0199a1',
        deep: '#085659',
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Minimum 16px sur mobile
        base: ['1rem', { lineHeight: '1.5' }],
      },
      minHeight: {
        // Boutons minimum 44px pour accessibilité mobile
        touch: '44px',
      },
      screens: {
        xs: '360px',
      },
    },
  },
  plugins: [],
} satisfies Config;
