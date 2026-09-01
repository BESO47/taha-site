/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand: deep zinc-black + electric yellow accent
        dodger: {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
          700: '#27272a',
          800: '#18181b',
          900: '#09090b',
          950: '#000000',
        },
        brand: {
          yellow: '#facc15',
          yellowDark: '#eab308',
          ink: '#09090b',
        },
        // semantic palettes used across cards/badges/forms
        success: {
          bg: 'rgb(236 253 245)',
          text: 'rgb(21 128 61)',
        },
      },
      fontFamily: {
        khaled: ['"Lalezar"', 'sans-serif'],
        messiri: ['"El Messiri"', 'serif'],
        outfit: ['"Outfit"', 'sans-serif'],
        ibm: ['"IBM Plex Sans Arabic"', 'sans-serif'],
        fs: ['"IBM Plex Sans Arabic"', 'sans-serif'],
        com: ['"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(250,204,21,0.25), 0 10px 40px -10px rgba(250,204,21,0.35)',
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.08)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
        shimmer: 'shimmer 2s linear infinite',
        fadeInUp: 'fadeInUp 0.4s ease-out',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
