/**
 * React-PDF helpers. Server-only — these files import @react-pdf/renderer
 * which depends on Node-only APIs.
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export const A4 = { width: 595, height: 842 };

export const colors = {
  ink: "#0f1115",
  bone: "#f6f5ef",
  blood: "#c0392b",
  volt: "#cdf564",
};

export const sharedStyles = StyleSheet.create({
  page: { padding: 28, backgroundColor: "#ffffff", color: colors.ink, fontSize: 9 },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 13, fontWeight: 700, marginBottom: 6 },
  meta: { fontSize: 8, color: "#666", marginBottom: 12 },
  table: { borderWidth: 1, borderColor: colors.ink },
  thead: { flexDirection: "row", borderBottomWidth: 1, borderColor: colors.ink, backgroundColor: "#eee" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#999", minHeight: 16 },
  th: { padding: 4, fontWeight: 700, fontSize: 8 },
  td: { padding: 4, fontSize: 8 },
  pageFooter: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 7, color: "#888", textAlign: "center" },
});

export { Document, Page, View, Text };
