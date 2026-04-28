/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bone: "#F4EFE6",
        ink: "#0B0B0C",
        blood: "#E5132A",
        volt: "#F5E663",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: { tight2: "-0.04em" },
    },
  },
  plugins: [],
};
