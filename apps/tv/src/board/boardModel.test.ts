import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderInstanceId, RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { boardTransitions, buildBoard, EMPTY_BOARD } from "./boardModel.ts";

const environmentId = "env-1" as EnvironmentId;
const projectId = "project-1" as ProjectId;

type ThreadOverrides = Partial<
  Pick<
    OrchestrationV2ThreadShell,
    | "status"
    | "pendingRuntimeRequest"
    | "lineage"
    | "settledOverride"
    | "latestRunStopRequested"
    | "updatedAt"
    | "archivedAt"
  >
>;

function thread(id: string, overrides: ThreadOverrides = {}) {
  return {
    id: id as ThreadId,
    projectId,
    lineage: { rootThreadId: id as ThreadId, parentThreadId: null, relationshipToParent: null },
    title: `Thread ${id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    status: "running" as const,
    activeRunId: null,
    latestRunId: null,
    pendingRuntimeRequest: null,
    settledOverride: null,
    updatedAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function snapshot(threads: ReadonlyArray<ReturnType<typeof thread>>) {
  return {
    environmentId,
    // The board reads only the awareness fields; the rest of the shell is irrelevant here.
    snapshot: {
      projects: [{ id: projectId, title: "t3code" }],
      threads,
    } as unknown as OrchestrationV2ShellSnapshot,
  };
}

const approval: OrchestrationV2ThreadShell["pendingRuntimeRequest"] = {
  id: RuntimeRequestId.make("request-1"),
  kind: "command",
  createdAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
};

describe("buildBoard", () => {
  it("groups threads by awareness phase and drops subagents", () => {
    const board = buildBoard([
      snapshot([
        thread("waiting", {
          pendingRuntimeRequest: approval,
        }),
        thread("running"),
        thread("done", { status: "completed" }),
        thread("failed", { status: "failed" }),
        thread("child", {
          lineage: {
            rootThreadId: "running" as ThreadId,
            parentThreadId: "running" as ThreadId,
            relationshipToParent: "subagent",
          },
        }),
      ]),
    ]);

    expect(board.needs_you.map((card) => card.threadId)).toEqual(["waiting"]);
    expect(board.running.map((card) => card.threadId)).toEqual(["running"]);
    expect(board.done.map((card) => card.threadId)).toEqual(["done"]);
    expect(board.failed.map((card) => card.threadId)).toEqual(["failed"]);
  });

  it("places recent threads the awareness projection skips and drops archived ones", () => {
    const board = buildBoard([
      snapshot([
        thread("idle", { status: "idle" }),
        thread("settled", { status: "completed", settledOverride: "settled" }),
        thread("settled-failure", { status: "failed", settledOverride: "settled" }),
        thread("interrupted", { status: "interrupted" }),
        thread("stopped", { status: "completed", latestRunStopRequested: true }),
        thread("queued", { status: "queued" }),
        thread("archived", {
          status: "idle",
          archivedAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
        }),
      ]),
    ]);

    const placed = (cards: typeof board.done) =>
      cards.map((card) => [card.threadId, card.headline]);
    expect(placed(board.done)).toEqual([
      ["idle", "Idle"],
      ["settled", "Settled"],
      ["settled-failure", "Settled"],
    ]);
    expect(placed(board.failed)).toEqual([
      ["interrupted", "Interrupted"],
      ["stopped", "Stopped"],
    ]);
    expect(placed(board.running)).toEqual([["queued", "Queued"]]);
  });

  it("keeps only the most recently updated idle threads", () => {
    const threads = Array.from({ length: 25 }, (_, minute) =>
      thread(`idle-${minute}`, {
        status: "idle",
        updatedAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 26, 12, minute)),
      }),
    );

    const done = buildBoard([snapshot(threads)]).done;

    expect(done).toHaveLength(20);
    expect(done[0]?.threadId).toBe("idle-24");
    expect(done.at(-1)?.threadId).toBe("idle-5");
  });
});

describe("boardTransitions", () => {
  it("announces nothing for the first board", () => {
    expect(
      boardTransitions(null, buildBoard([snapshot([thread("a", { status: "failed" })])])),
    ).toEqual([]);
  });

  it("announces a thread once when it moves into done", () => {
    const running = buildBoard([snapshot([thread("a")])]);
    const done = buildBoard([snapshot([thread("a", { status: "completed" })])]);

    expect(boardTransitions(running, done).map((t) => [t.card.threadId, t.column])).toEqual([
      ["a", "done"],
    ]);
    expect(boardTransitions(done, done)).toEqual([]);
  });

  it("announces a thread that appears already waiting", () => {
    const next = buildBoard([
      snapshot([
        thread("b", {
          pendingRuntimeRequest: approval,
        }),
      ]),
    ]);

    expect(boardTransitions(EMPTY_BOARD, next).map((t) => t.column)).toEqual(["needs_you"]);
  });

  it("does not announce threads that are only shown because they are recent", () => {
    const running = buildBoard([snapshot([thread("a")])]);
    const after = buildBoard([
      snapshot([thread("a", { status: "interrupted" }), thread("b", { status: "idle" })]),
    ]);

    expect(boardTransitions(running, after)).toEqual([]);
  });
});
