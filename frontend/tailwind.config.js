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
      },
    },
  },
  plugins: [],
};
