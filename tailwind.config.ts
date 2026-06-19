import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        velocity: "#2F7BFF",
        "velocity-deep": "#1F6BEF",
        "velocity-light": "#7BB0FF",
      },
      fontFamily: {
        brand: ["var(--font-brand)", "sans-serif"],
        sans: ["var(--font-geist-sans)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
