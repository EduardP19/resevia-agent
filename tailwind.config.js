/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: "#6D28D9",
          'purple-mid': "#7C3AED",
          'purple-light': "#8B5CF6",
          gold: "#C9A96E",
          'gold-light': "#D4B483",
          deep: "#271549",
          cream: "#FBF5E9",
          orange: "#f97316",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        display: ['Montserrat', '"Plus Jakarta Sans"', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 50%, #C9A96E 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #1a0a35 0%, #271549 60%, #1a1030 100%)',
      },
      boxShadow: {
        brand: '0 8px 32px rgba(109, 40, 217, 0.25)',
        'brand-lg': '0 16px 48px rgba(109, 40, 217, 0.3)',
        gold: '0 8px 24px rgba(201, 169, 110, 0.2)',
        card: '0 2px 16px rgba(39, 21, 73, 0.08)',
        'card-hover': '0 8px 40px rgba(39, 21, 73, 0.15)',
      },
    },
  },
  plugins: [],
}
