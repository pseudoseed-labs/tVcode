import type { BoardColumnId } from "./board/boardModel";

// Dark tokens from apps/web/src/index.css, resolved to sRGB (React Native has no color-mix).
export const colors = {
  background: "#0a0a0a", // neutral-950
  card: "#121212", // background 97% + white
  cardFocused: "#1f1f22",
  foreground: "#f5f5f5", // neutral-100
  mutedForeground: "#828282", // neutral-500 90% + white
  border: "rgba(255,255,255,0.06)",
  borderFocused: "rgba(255,255,255,0.32)",
  primary: "#4c63f2", // oklch(0.571 0.21 264)
  primaryForeground: "#ffffff",
  error: "#fb414a",
  success: "#00d492", // emerald-400
  warning: "#ffba00", // amber-400
  info: "#51a2ff", // blue-400
} as const;

export const columnAccent: Record<BoardColumnId, string> = {
  needs_you: colors.warning,
  running: colors.info,
  done: colors.success,
  failed: colors.error,
};

// tvOS HIG sizes for a 1920x1080 point canvas viewed from a couch.
export const type = {
  title: 57,
  headline: 38,
  body: 29,
  callout: 25,
  caption: 23,
  mono: "Menlo",
} as const;

export const space = { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, safeX: 80, safeY: 60 } as const;

// The transition banner sits in the screen header band, above the thread screen's side column.
export const layout = { sideColumnWidth: 516, bannerHeight: 68 } as const;
