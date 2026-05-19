import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0a",
        bg: "#ffffff",
        bgAlt: "#f7f8fa",
        bgSubtle: "#fafbfc",
        line: "#e5e7eb",
        lineStrong: "#d1d5db",
        muted: {
          DEFAULT: "#6b7280",
          strong: "#4b5563",
          faint: "#9ca3af",
        },
        // Brand — WDC blue (water)
        brand: {
          50: "#eff6fb",
          100: "#d6e7f1",
          200: "#aecfe3",
          300: "#7eb1cf",
          400: "#5293b9",
          500: "#2f78a1",
          600: "#1e5b8f", // primary
          700: "#194a75",
          800: "#143b5e",
          900: "#0d2944",
        },
        // Accent — WDC sage green (the wave curve at the base of the logo)
        accent: {
          50: "#f1f6f3",
          100: "#dde9e1",
          200: "#bdd2c4",
          300: "#97b8a3",
          400: "#75a78c", // logo green
          500: "#5d9477",
          600: "#4a7d63", // solid accent
          700: "#3d6852",
          800: "#325443",
          900: "#294438",
        },
        warn: "#d97706",
        warnLight: "#fef3c7",
        danger: "#dc2626",
        dangerLight: "#fee2e2",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        arabic: ["var(--font-arabic)", '"Noto Sans Arabic"', "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10, 10, 10, 0.04)",
        cardHover: "0 4px 12px rgba(10, 10, 10, 0.06)",
        focus: "0 0 0 3px rgba(30, 91, 143, 0.18)",
      },
      borderRadius: {
        DEFAULT: "8px",
        lg: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
