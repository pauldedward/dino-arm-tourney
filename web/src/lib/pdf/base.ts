/**
 * React-PDF helpers. Server-only — these files import `@react-pdf/renderer`
 * which depends on Node-only APIs. Never import into a client component.
 *
 * Palette mirrors our Tailwind theme so printed output looks on-brand.
 */
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// Disable react-pdf's default word-splitting so a long word like
// "Association" never breaks across two lines as "Asso" / "ciation".
// The callback receives a single word and must return the segments it
// should be broken into; returning [word] keeps it whole.
Font.registerHyphenationCallback((word) => [word]);

export const A4 = { width: 595, height: 842 };

export const colors = {
  ink: "#0A1B14",
  bone: "#F6F1E4",
  moss: "#0F3D2E",
  gold: "#F5C518",
  rust: "#B23A1E",
  kraft: "#CDBB93",
};

export const sharedStyles = StyleSheet.create({
  page: { padding: 28, backgroundColor: "#ffffff", color: colors.ink, fontSize: 9 },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 13, fontWeight: 700, marginBottom: 6 },
  meta: { fontSize: 8, color: "#666", marginBottom: 12 },
  table: { borderWidth: 1, borderColor: colors.ink },
  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: colors.ink,
    backgroundColor: "#eee",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#999",
    minHeight: 16,
  },
  th: { padding: 4, fontWeight: 700, fontSize: 8 },
  td: { padding: 4, fontSize: 8 },
  pageFooter: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 7,
    color: "#888",
    textAlign: "center",
  },
});

export { Document, Image, Page, View, Text };
