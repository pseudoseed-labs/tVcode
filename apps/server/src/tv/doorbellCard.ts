export const CARD_WIDTH = 1280;
export const CARD_HEIGHT = 720;

export type DoorbellCardStatus =
  | "pending-approval"
  | "awaiting-input"
  | "completed"
  | "failed"
  | "test";

export interface DoorbellCardInput {
  /** Null for the resting card shown before any ring. */
  readonly status: DoorbellCardStatus | null;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly branch: string | null;
  /** Compact age, as the sidebar shows it: "now", "5m", "2h". */
  readonly age: string | null;
}

// The sidebar's dark theme ([data-app-sidebar] in apps/web/src/index.css).
const THEME = {
  background: "#000000",
  foreground: "#f1f3f7",
  muted: "#a3a3a3",
} as const;

const ROW = { top: 140, height: 540 } as const;

// Sidebar.logic.ts status pills, dark variant; Tailwind v4 300 shades at /90 (sky at /80).
const STATUS: Record<DoorbellCardStatus, { label: string; color: string; opacity: number }> = {
  "pending-approval": { label: "Pending Approval", color: "#ffd230", opacity: 0.9 },
  "awaiting-input": { label: "Awaiting Input", color: "#a3b3ff", opacity: 0.9 },
  completed: { label: "Completed", color: "#5ee9b5", opacity: 0.9 },
  failed: { label: "Failed", color: "#ffa2a2", opacity: 0.9 },
  test: { label: "Test", color: "#74d4ff", opacity: 0.8 },
};

// assets/prod/logo.svg, inlined so the card needs no file reads.
const T3_LOGO = `<rect width="128" height="128" rx="10" fill="#000"/><path fill="#fff" d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/>`;

// lucide folder and git-branch, on their 24px grid.
const FOLDER_ICON = `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`;
const BRANCH_ICON = `<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>`;

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Truncates by code points so emoji and CJK titles never split mid-character. */
export const clip = (value: string, max: number) => {
  const chars = [...normalize(value)];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
};

/** Word-wraps into at most `maxLines` lines of `perLine` code points; the last line is clipped. */
export function wrapLines(value: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = [...normalize(value)];
  while (rest.length > 0 && lines.length < maxLines - 1) {
    if (rest.length <= perLine) break;
    const space = rest.lastIndexOf(" ", perLine);
    const cut = space > 0 ? space : perLine;
    lines.push(rest.slice(0, cut).join("").trimEnd());
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  if (rest.length > 0) lines.push(clip(rest.join(""), perLine));
  return lines;
}

/** The sidebar's compact relative time. */
export function compactAge(elapsedMs: number): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const icon = (body: string, x: number, y: number, size: number) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${THEME.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

/**
 * The sidebar thread row, scaled up for a TV across the room. Other sizes letterbox the
 * 1280x720 layout; the margins render transparent, which JPEG encodes as the black background.
 */
export function buildDoorbellCardSvg(
  input: DoorbellCardInput,
  size: { readonly width: number; readonly height: number } = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
): string {
  const status = input.status ? STATUS[input.status] : null;
  const parts: string[] = [];
  let y = 0;
  if (status) {
    const paint = `fill="${status.color}" fill-opacity="${status.opacity}"`;
    parts.push(
      `<circle cx="126" cy="-18" r="13" ${paint}/>`,
      `<text x="158" y="${y}" font-size="52" font-weight="600" ${paint}>${escapeXml(status.label)}</text>`,
    );
  }
  if (input.age)
    parts.push(
      `<text x="1168" y="${y}" font-size="48" text-anchor="end" fill="${THEME.muted}">${escapeXml(input.age)}</text>`,
    );
  // Baselines from here on; the block is centred in the row once its height is known.
  y += status || input.age ? 104 : 54;
  for (const line of wrapLines(input.threadTitle, 25, 2)) {
    parts.push(
      `<text x="112" y="${y}" font-size="76" font-weight="600" fill="${THEME.foreground}">${escapeXml(line)}</text>`,
    );
    y += 90;
  }
  const meta = [
    { glyph: FOLDER_ICON, text: input.projectTitle },
    { glyph: BRANCH_ICON, text: input.branch ?? "" },
  ].filter((row) => normalize(row.text) !== "");
  for (const row of meta) {
    parts.push(
      icon(row.glyph, 112, y - 36, 44),
      `<text x="176" y="${y}" font-size="44" fill="${THEME.muted}">${escapeXml(clip(row.text, 42))}</text>`,
    );
    y += 64;
  }
  const top = status || input.age ? -38 : 0;
  const bottom = y - (meta.length > 0 ? 64 : 90) + 14;
  const offset = Math.round(ROW.top + (ROW.height - (bottom - top)) / 2 - top);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" font-family="DM Sans">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${THEME.background}"/>
  <g transform="translate(56 36) scale(0.5625)">${T3_LOGO}<rect x="2" y="2" width="124" height="124" rx="9" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="4"/></g>
  <text x="152" y="94" font-size="44" font-weight="700" fill="${THEME.foreground}">T3 Code</text>
  <rect x="48" y="${ROW.top}" width="1184" height="${ROW.height}" rx="32" fill="#ffffff" fill-opacity="0.07" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>
  <g transform="translate(0 ${offset})">
  ${parts.join("\n  ")}
  </g>
</svg>`;
}
