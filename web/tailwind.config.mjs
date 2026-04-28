/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // TN AWA brand (editable per-event via events.primary_color/accent_color).
        // These are the app-chrome defaults only; ID cards + event pages pull
        // their palette from the event row, not from Tailwind.
        ink: "#0A1B14", // deep forest
        bone: "#F6F1E4", // warm paper
        paper: "#F6F1E4", // alias of bone (light bg / on-dark text)
        moss: "#0F3D2E", // default primary (matches events.primary_color)
        gold: "#F5C518", // default accent (matches events.accent_color)
        volt: "#F5C518", // alias of gold (accent highlight)
        rust: "#B23A1E", // error / urgent
        kraft: "#CDBB93", // muted
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        ticket: "2px",
      },
    },
  },
  plugins: [],
};
