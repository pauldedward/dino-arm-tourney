import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";
import { formatCategoryCode } from "@/lib/rules/category-label";

export type BracketSide = "W" | "L" | "GF";

export type FixtureSide = {
  side: BracketSide;
  rounds: Array<{
    round_no: number;
    matches: Array<{
      match_no: number;
      a: string | null;
      b: string | null;
      /** Number of games played for this match. 1 = single, 3 = best-of-3 (GF default). */
      best_of: number;
    }>;
  }>;
};

export type FixtureRow = {
  category_code: string;
  /**
   * One entry per bracket side actually present (W always; L + GF only for
   * double-elim). Single-elim categories produce a single `W` side.
   */
  sides: FixtureSide[];
};

const SIDE_LABEL: Record<BracketSide, string> = {
  W: "Winners' Bracket",
  L: "Losers' Bracket",
  GF: "Grand Final",
};

/**
 * One slot inside a match card. If `value` is set we print the athlete name;
 * otherwise we draw a blank ruled line so the head referee can write the
 * advancing name in pen during the run-of-show.
 */
function Slot({
  label,
  value,
  fallback,
}: {
  label: string; // "A" or "B"
  value: string | null;
  fallback: "BYE" | "TBD";
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        marginTop: 2,
      }}
    >
      <Text style={{ fontSize: 6.5, color: "#666", width: 8 }}>{label}</Text>
      {/* Tiny "winner" tick box. Ref circles the winner during the match. */}
      <View
        style={{
          width: 7,
          height: 7,
          borderWidth: 0.5,
          borderColor: "#333",
          marginRight: 4,
        }}
      />
      {value ? (
        <Text style={{ fontSize: 8, flex: 1 }}>{value}</Text>
      ) : (
        <View
          style={{
            flex: 1,
            borderBottomWidth: 0.5,
            borderBottomColor: "#666",
            borderStyle: fallback === "BYE" ? "solid" : "dashed",
            minHeight: 10,
          }}
        >
          <Text style={{ fontSize: 6.5, color: "#aaa" }}>
            {fallback === "BYE" ? "BYE" : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

export function FixturesSheet({
  event,
  categories,
}: {
  event: { name: string };
  categories: FixtureRow[];
}) {
  return (
    <Document>
      {categories.map((cat) => (
        <Page key={cat.category_code} size="A4" style={sharedStyles.page}>
          <Text style={sharedStyles.h1}>{event.name}</Text>
          <Text style={sharedStyles.h2}>{formatCategoryCode(cat.category_code)}</Text>
          <Text style={{ fontSize: 7, color: "#666", marginBottom: 4 }}>
            code: {cat.category_code} · Tick the winner box, write the advancing name on the next round&apos;s blank line.
          </Text>
          {cat.sides.map((s) => {
            const totalRounds = s.rounds.length;
            return (
              <View key={s.side} style={{ marginTop: 8 }} wrap={false}>
                <Text
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    marginBottom: 4,
                    backgroundColor: "#111",
                    color: "#fff",
                    padding: 3,
                  }}
                >
                  {SIDE_LABEL[s.side]} · {totalRounds} round
                  {totalRounds === 1 ? "" : "s"}
                </Text>
                <View style={{ flexDirection: "row" }}>
                  {s.rounds.map((r) => (
                    <View key={r.round_no} style={{ flex: 1, paddingRight: 6 }}>
                      <Text
                        style={{ fontSize: 9, fontWeight: 700, marginBottom: 4 }}
                      >
                        {s.side === "GF" ? "GF" : `R${r.round_no}`}
                      </Text>
                      {r.matches.map((m) => {
                        // Round-1 winners' bracket is the only place a missing
                        // slot is a real bye; everywhere else the slot is just
                        // pending an upstream winner — give the ref a blank
                        // line to write into.
                        const fallback: "BYE" | "TBD" =
                          s.side === "W" && r.round_no === 1 ? "BYE" : "TBD";
                        return (
                          <View
                            key={m.match_no}
                            style={{
                              borderWidth: 0.5,
                              borderColor: "#333",
                              padding: 4,
                              marginBottom: 4,
                              minHeight: m.best_of > 1 ? 78 : 60,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 6.5,
                                  fontWeight: 700,
                                  color: "#111",
                                }}
                              >
                                M{m.match_no}
                              </Text>
                              <Text style={{ fontSize: 6, color: "#999" }}>
                                Time ____
                              </Text>
                            </View>
                            <Slot label="A" value={m.a} fallback={fallback} />
                            <Slot label="B" value={m.b} fallback={fallback} />
                            {m.best_of > 1 ? (
                              <View
                                style={{
                                  marginTop: 4,
                                  paddingTop: 2,
                                  borderTopWidth: 0.5,
                                  borderTopColor: "#ccc",
                                  flexDirection: "row",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 6,
                                    fontWeight: 700,
                                    color: "#111",
                                    marginRight: 4,
                                  }}
                                >
                                  BEST OF {m.best_of}
                                </Text>
                                {Array.from({ length: m.best_of }).map((_, gi) => (
                                  <View
                                    key={gi}
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      marginRight: 6,
                                    }}
                                  >
                                    <Text style={{ fontSize: 6, color: "#666", marginRight: 2 }}>
                                      G{gi + 1}
                                    </Text>
                                    <Text style={{ fontSize: 6, color: "#666", marginRight: 1 }}>
                                      A
                                    </Text>
                                    <View
                                      style={{
                                        width: 6,
                                        height: 6,
                                        borderWidth: 0.5,
                                        borderColor: "#333",
                                        marginRight: 3,
                                      }}
                                    />
                                    <Text style={{ fontSize: 6, color: "#666", marginRight: 1 }}>
                                      B
                                    </Text>
                                    <View
                                      style={{
                                        width: 6,
                                        height: 6,
                                        borderWidth: 0.5,
                                        borderColor: "#333",
                                      }}
                                    />
                                  </View>
                                ))}
                              </View>
                            ) : null}
                            <View
                              style={{
                                marginTop: 4,
                                paddingTop: 2,
                                borderTopWidth: 0.5,
                                borderTopColor: "#ccc",
                                flexDirection: "row",
                              }}
                            >
                              <Text style={{ fontSize: 6, color: "#666" }}>
                                Ref ____
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          <Text
            style={sharedStyles.pageFooter}
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
            fixed
          />
        </Page>
      ))}
    </Document>
  );
}


