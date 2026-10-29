import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { memo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";

import { FocusButton } from "../components/FocusButton";
import { boardAtom } from "../state/atoms";
import { colors, columnAccent, layout, space, type } from "../theme";
import { BOARD_COLUMNS, boardCardKey, type BoardCard, type BoardColumnId } from "./boardModel";

export interface ThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const Card = memo(function Card(props: {
  readonly card: BoardCard;
  readonly column: BoardColumnId;
  readonly preferredFocus: boolean;
  readonly onOpen: (ref: ThreadRef) => void;
}) {
  const [focused, setFocused] = useState(false);
  const { card } = props;
  return (
    <Pressable
      hasTVPreferredFocus={props.preferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => props.onOpen({ environmentId: card.environmentId, threadId: card.threadId })}
      style={[styles.card, focused && styles.cardFocused]}
    >
      <View style={[styles.cardAccent, { backgroundColor: columnAccent[props.column] }]} />
      <Text style={styles.cardProject} numberOfLines={1}>
        {card.projectTitle}
      </Text>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {card.threadTitle}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {card.headline} · {relativeTime(card.updatedAt)}
      </Text>
    </Pressable>
  );
});

export function BoardScreen(props: {
  readonly onOpenThread: (ref: ThreadRef) => void;
  readonly onOpenConnection: () => void;
}) {
  const { board, live, error, blocked } = useAtomValue(boardAtom);
  const firstColumn = BOARD_COLUMNS.find(({ id }) => board[id].length > 0)?.id;

  return (
    <View style={styles.screen}>
      {/* The guide spans the header so Up from any column reaches the Connection button. */}
      <TVFocusGuideView style={styles.header} autoFocus>
        <Text style={styles.title}>T3 Code</Text>
        <Text
          style={[styles.status, { color: error ? colors.error : colors.mutedForeground }]}
          numberOfLines={1}
        >
          {error ?? (live ? "Live" : "Connecting…")}
        </Text>
        <FocusButton
          label="Connection"
          tone={blocked ? "danger" : "neutral"}
          preferredFocus={blocked}
          onPress={props.onOpenConnection}
          style={styles.connection}
        />
      </TVFocusGuideView>
      <TVFocusGuideView style={styles.columns} autoFocus>
        {BOARD_COLUMNS.map(({ id, title }) => (
          <TVFocusGuideView key={id} style={styles.column} autoFocus>
            <View style={styles.columnHeader}>
              <View style={[styles.dot, { backgroundColor: columnAccent[id] }]} />
              <Text style={styles.columnTitle}>{title}</Text>
              <Text style={styles.columnCount}>{board[id].length}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.columnBody}>
              {board[id].length === 0 ? (
                <Text style={styles.empty}>Nothing here</Text>
              ) : (
                board[id].map((card, index) => (
                  <Card
                    key={boardCardKey(card)}
                    card={card}
                    column={id}
                    preferredFocus={!blocked && id === firstColumn && index === 0}
                    onOpen={props.onOpenThread}
                  />
                ))
              )}
            </ScrollView>
          </TVFocusGuideView>
        ))}
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: space.safeX,
    paddingTop: space.safeY,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.md,
    minHeight: layout.bannerHeight,
    marginBottom: space.lg,
    paddingRight: layout.sideColumnWidth + space.md,
  },
  title: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  status: { fontSize: type.callout, flexShrink: 1 },
  connection: { marginLeft: "auto", alignSelf: "center" },
  columns: { flex: 1, flexDirection: "row", gap: space.md },
  column: { flex: 1 },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginBottom: space.sm,
  },
  dot: { width: 16, height: 16, borderRadius: 8 },
  columnTitle: { color: colors.foreground, fontSize: type.headline, fontWeight: "600", flex: 1 },
  columnCount: { color: colors.mutedForeground, fontSize: type.headline },
  columnBody: { gap: space.sm, paddingVertical: space.sm, paddingHorizontal: 6 },
  empty: { color: colors.mutedForeground, fontSize: type.callout, paddingVertical: space.md },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 3,
    borderRadius: 18,
    padding: space.md,
    paddingLeft: space.md + 8,
    overflow: "hidden",
  },
  cardFocused: {
    backgroundColor: colors.cardFocused,
    borderColor: colors.borderFocused,
    transform: [{ scale: 1.04 }],
  },
  cardAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 8 },
  cardProject: { color: colors.mutedForeground, fontSize: type.caption },
  cardTitle: { color: colors.foreground, fontSize: type.body, fontWeight: "600", marginTop: 4 },
  cardMeta: { color: colors.mutedForeground, fontSize: type.caption, marginTop: space.xs },
});
