import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { type Board, type BoardTransition, boardTransitions } from "../board/boardModel";
import { boardAtom } from "../state/atoms";
import { colors, columnAccent, layout, space, type } from "../theme";

const VISIBLE_MS = 5_000;
const MAX_STACK = 3;

const LABEL: Record<BoardTransition["column"], string> = {
  needs_you: "Needs you",
  done: "Done",
  failed: "Failed",
};

interface Toast extends BoardTransition {
  readonly id: number;
}

export function TransitionOverlay() {
  const { board, live } = useAtomValue(boardAtom);
  const previous = useRef<Board | null>(null);
  const nextId = useRef(0);
  const [toasts, setToasts] = useState<ReadonlyArray<Toast>>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // Before the shell is live the board is still filling in; that is not a transition.
    if (!live) {
      previous.current = null;
      return;
    }
    const fresh = boardTransitions(previous.current, board).map((transition) => ({
      ...transition,
      id: nextId.current++,
    }));
    previous.current = board;
    if (fresh.length === 0) return;
    setToasts((current) => [...fresh, ...current].slice(0, MAX_STACK));
    // A later board update must not cancel this batch's dismissal.
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const ids = new Set(fresh.map((toast) => toast.id));
      setToasts((current) => current.filter((toast) => !ids.has(toast.id)));
    }, VISIBLE_MS);
    timers.current.add(timer);
  }, [board, live]);

  const [toast] = toasts;
  if (toast === undefined) return null;
  const accent = columnAccent[toast.column];
  return (
    <View pointerEvents="none" style={[styles.banner, { borderColor: accent }]}>
      <Text style={[styles.kind, { color: accent }]}>{LABEL[toast.column]}</Text>
      <Text style={styles.title} numberOfLines={1}>
        {toast.card.threadTitle}
      </Text>
      {toasts.length > 1 && <Text style={styles.more}>+{toasts.length - 1}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: space.safeY,
    right: space.safeX,
    width: layout.sideColumnWidth,
    height: layout.bannerHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: "rgba(18,18,18,0.96)",
    borderWidth: 3,
    borderRadius: 20,
    paddingHorizontal: space.md,
  },
  kind: { fontSize: type.caption, fontWeight: "700", textTransform: "uppercase" },
  title: { color: colors.foreground, fontSize: type.callout, fontWeight: "600", flex: 1 },
  more: { color: colors.mutedForeground, fontSize: type.caption },
});
