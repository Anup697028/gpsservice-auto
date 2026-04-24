/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#f26a21',
        'background-light': '#f8f6f5',
        'background-dark': '#221610',
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
}

