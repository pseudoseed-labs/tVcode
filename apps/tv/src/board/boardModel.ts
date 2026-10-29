import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { type AgentAwarenessPhase, projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";

export type BoardColumnId = "needs_you" | "running" | "done" | "failed";

export const BOARD_COLUMNS: ReadonlyArray<{ readonly id: BoardColumnId; readonly title: string }> =
  [
    { id: "needs_you", title: "Needs you" },
    { id: "running", title: "Running" },
    { id: "done", title: "Done" },
    { id: "failed", title: "Failed" },
  ];

export function columnForPhase(phase: AgentAwarenessPhase): BoardColumnId {
  switch (phase) {
    case "waiting_for_approval":
    case "waiting_for_input":
      return "needs_you";
    case "starting":
    case "running":
    case "stale":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
  }
}

export interface BoardCard {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly headline: string;
  readonly updatedAt: string;
  /** Shown only because it is recent, not because the agent needs attention; never announced. */
  readonly recent: boolean;
}

const RECENT_LIMIT = 20;

function recentPlacement(thread: OrchestrationV2ThreadShell): {
  readonly column: BoardColumnId;
  readonly headline: string;
} {
  if (thread.settledOverride === "settled") return { column: "done", headline: "Settled" };
  switch (thread.status) {
    case "queued":
      return { column: "running", headline: "Queued" };
    case "interrupted":
      return { column: "failed", headline: "Interrupted" };
    case "cancelled":
      return { column: "failed", headline: "Cancelled" };
    case "failed":
      return { column: "failed", headline: "Agent failed" };
    case "completed":
      return thread.latestRunStopRequested === true
        ? { column: "failed", headline: "Stopped" }
        : { column: "done", headline: "Agent finished" };
    case "rolled_back":
      return { column: "done", headline: "Rolled back" };
    default:
      return { column: "done", headline: "Idle" };
  }
}

export type Board = Readonly<Record<BoardColumnId, ReadonlyArray<BoardCard>>>;

export const EMPTY_BOARD: Board = { needs_you: [], running: [], done: [], failed: [] };

export function boardCardKey(card: Pick<BoardCard, "environmentId" | "threadId">): string {
  return `${card.environmentId}:${card.threadId}`;
}

export function buildBoard(
  shells: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly snapshot: OrchestrationV2ShellSnapshot;
  }>,
): Board {
  const columns: Record<BoardColumnId, BoardCard[]> = {
    needs_you: [],
    running: [],
    done: [],
    failed: [],
  };
  const recent: Array<{ readonly column: BoardColumnId; readonly card: BoardCard }> = [];
  for (const { environmentId, snapshot } of shells) {
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    for (const thread of snapshot.threads) {
      const project = projects.get(thread.projectId);
      if (project === undefined || thread.archivedAt !== null) continue;
      if (thread.lineage.relationshipToParent === "subagent") continue;
      const state = projectThreadAwarenessV2({ environmentId, project, thread });
      const card = {
        environmentId,
        threadId: thread.id,
        projectTitle: project.title,
        threadTitle: thread.title,
        updatedAt: DateTime.formatIso(thread.updatedAt),
      };
      if (state === null) {
        const { column, headline } = recentPlacement(thread);
        recent.push({ column, card: { ...card, headline, recent: true } });
      } else {
        columns[columnForPhase(state.phase)].push({
          ...card,
          headline: state.headline,
          recent: false,
        });
      }
    }
  }
  recent.sort((a, b) => b.card.updatedAt.localeCompare(a.card.updatedAt));
  for (const { column, card } of recent.slice(0, RECENT_LIMIT)) columns[column].push(card);
  for (const cards of Object.values(columns)) {
    cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return columns;
}

export interface BoardTransition {
  readonly card: BoardCard;
  readonly column: Exclude<BoardColumnId, "running">;
}

/** Cards that entered needs-you, done or failed since `previous`; none on the first board. */
export function boardTransitions(previous: Board | null, next: Board): BoardTransition[] {
  if (previous === null) return [];
  const before = new Map<string, BoardColumnId>();
  for (const { id } of BOARD_COLUMNS) {
    for (const card of previous[id]) before.set(boardCardKey(card), id);
  }
  const transitions: BoardTransition[] = [];
  for (const column of ["needs_you", "done", "failed"] as const) {
    for (const card of next[column]) {
      if (!card.recent && before.get(boardCardKey(card)) !== column) {
        transitions.push({ card, column });
      }
    }
  }
  return transitions;
}
