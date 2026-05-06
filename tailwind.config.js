/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/entities/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/widgets/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/shared/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "primary-color": "var(--primary-color)",
        "button-primary": "var(--color-button-primary)",
        "button-secondary": "var(--color-button-secondary)",
      },
      fontFamily: {
        sans:
          "var(--font-plus-jakarta-sans), ui-sans-serif, system-ui, sans-serif",
        mono: "var(--font-geist-mono), ui-monospace, monospace",
      },
    },
  },
  plugins: [],
};

