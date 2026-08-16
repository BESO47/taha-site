/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Redefine dodger/brand to Black & Electric Yellow theme
        dodger: {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#d97706',
          700: '#27272a',
          800: '#18181b',
          900: '#09090b',
          950: '#000000',
        },
        yellowBrand: {
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
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
    },
  },
  plugins: [],
}
