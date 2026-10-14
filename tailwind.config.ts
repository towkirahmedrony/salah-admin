import type { Config } from "tailwindcss";

/**
 * Salah Admin design tokens.
 *
 * The brand ramp is a deep emerald / forest green. Surfaces are neutral, status
 * colours are semantic, and shadows stay restrained so the data is the loudest
 * thing on the page.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f8fafc",
          subtle: "#f1f5f9",
          border: "#e2e8f0",
        },
        ink: {
          900: "#0f172a",
          700: "#334155",
          500: "#64748b",
          400: "#94a3b8",
        },
        status: {
          draft: "#64748b",
          published: "#047857",
          archived: "#78350f",
          pending: "#b45309",
          verified: "#047857",
          unverified: "#b45309",
          rejected: "#b91c1c",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans Bengali",
          "Hind Siliguri",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        raised: "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)",
      },
      maxWidth: {
        content: "88rem",
      },
    },
  },
  plugins: [],
};

export default config;
