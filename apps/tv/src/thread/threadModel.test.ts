import { describe, expect, it } from "@effect/vitest";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  approvalChoices,
  initialDraft,
  pendingDecision,
  questionAnswers,
  threadViewStatus,
  toggleOption,
} from "./threadModel.ts";

const createdAt = DateTime.makeUnsafe("2026-10-26T12:00:00.000Z");

function request(id: string, kind: string, capability: string = "live") {
  return {
    id,
    kind,
    status: "pending",
    createdAt,
    responseCapability:
      capability === "live"
        ? { type: "live", providerSessionId: "session-1" }
        : { type: capability, reason: "gone" },
  };
}

function requests(
  runtimeRequests: ReadonlyArray<ReturnType<typeof request>>,
  turnItems: ReadonlyArray<Record<string, unknown>>,
) {
  // Pending requests are derived from runtime requests and their turn items only.
  return { runtimeRequests, turnItems } as unknown as OrchestrationV2ThreadProjection;
}

const question = {
  type: "user_input_request",
  requestId: "ask-1",
  questions: [
    {
      id: "q1",
      header: "Database",
      question: "Which database?",
      options: [
        { label: "Postgres", description: "Relational" },
        { label: "SQLite", description: "Embedded" },
      ],
    },
  ],
};

describe("approvalChoices", () => {
  it("offers exactly the decisions the provider sent, with its labels", () => {
    const choices = approvalChoices([
      { decision: "acceptAlways", label: "Always allow", warning: "Applies to every project" },
      { decision: "decline", label: "Reject" },
    ]);

    expect(choices.map((choice) => [choice.decision, choice.label, choice.tone])).toEqual([
      ["acceptAlways", "Always allow", "neutral"],
      ["decline", "Reject", "danger"],
    ]);
    expect(choices[0]?.warning).toBe("Applies to every project");
  });

  it("falls back to approve and deny when the provider sent no options", () => {
    for (const options of [undefined, []]) {
      expect(approvalChoices(options).map((choice) => choice.decision)).toEqual([
        "accept",
        "decline",
      ]);
    }
  });
});

describe("pendingDecision", () => {
  it("shows a blocking question when no approval is pending", () => {
    const pending = pendingDecision(requests([request("ask-1", "user_input")], [question]));

    expect(pending?.kind).toBe("question");
    expect(
      pending?.kind === "question" &&
        pending.input.questions.map((entry) => [
          entry.question,
          entry.options.map((option) => option.label),
        ]),
    ).toEqual([["Which database?", ["Postgres", "SQLite"]]]);
  });

  it("prefers an answerable approval, then a question, over a dead approval", () => {
    const approvalItem = (requestId: string) => ({
      type: "approval_request",
      requestId,
      requestKind: "command",
    });
    const dead = request("dead", "command", "not_resumable");
    const live = request("live", "command");
    const ask = request("ask-1", "user_input");

    const withLive = pendingDecision(
      requests([dead, ask, live], [approvalItem("dead"), question, approvalItem("live")]),
    );
    expect(withLive?.kind === "approval" && withLive.approval.requestId).toBe("live");

    const withoutLive = pendingDecision(requests([dead, ask], [approvalItem("dead"), question]));
    expect(withoutLive?.kind).toBe("question");

    expect(pendingDecision(requests([], []))).toBeNull();
  });
});

describe("question answers", () => {
  const single = {
    id: "db",
    header: "Database",
    question: "Which database?",
    multiSelect: false,
    options: [
      { label: "Postgres", description: "Relational", value: "pg" },
      { label: "SQLite", description: "Embedded" },
    ],
  };
  const multi = {
    id: "extras",
    header: "Extras",
    question: "Add which?",
    multiSelect: true,
    options: [
      { label: "Auth", description: "Login" },
      { label: "Billing", description: "Stripe" },
    ],
  };

  it("answers with the option value, falling back to the label", () => {
    expect(
      questionAnswers([single], { db: toggleOption(single, initialDraft(single), "pg") }),
    ).toEqual({
      db: "pg",
    });
    expect(
      questionAnswers([single], { db: toggleOption(single, initialDraft(single), "SQLite") }),
    ).toEqual({ db: "SQLite" });
  });

  it("toggles multi-select options and needs at least one", () => {
    let draft = toggleOption(multi, initialDraft(multi), "Auth");
    draft = toggleOption(multi, draft, "Billing");
    expect(questionAnswers([multi], { extras: draft })).toEqual({ extras: ["Auth", "Billing"] });
    draft = toggleOption(multi, toggleOption(multi, draft, "Auth"), "Billing");
    expect(questionAnswers([multi], { extras: draft })).toBeNull();
  });

  it("prefers a typed answer unless the question forbids one", () => {
    const typed = { selected: ["pg"], custom: "  MySQL " };
    expect(questionAnswers([single], { db: typed })).toEqual({ db: "MySQL" });
    expect(questionAnswers([{ ...single, allowCustomAnswer: false }], { db: typed })).toEqual({
      db: "pg",
    });
  });

  it("is incomplete until every question is answered, seeding initial answers", () => {
    expect(questionAnswers([single, multi], {})).toBeNull();
    expect(questionAnswers([{ ...single, initialAnswer: "Postgres 17" }], {})).toEqual({
      db: "Postgres 17",
    });
    expect(questionAnswers([single], { db: { selected: ["gone"], custom: "" } })).toBeNull();
  });
});

describe("threadViewStatus", () => {
  const connected: EnvironmentConnectionPresentation = {
    phase: "connected",
    error: null,
    traceId: null,
  };
  const view = (
    status: EnvironmentThreadStatus,
    options: {
      readonly hasData?: boolean;
      readonly failure?: string;
      readonly connection?: EnvironmentConnectionPresentation;
    } = {},
  ) =>
    threadViewStatus({
      status,
      hasData: options.hasData ?? true,
      failure: options.failure ?? null,
      connection: options.connection ?? connected,
    });

  it("is live only while the thread is live on a connected environment", () => {
    expect(view("live")).toEqual({ kind: "live" });
    expect(
      view("live", { connection: { phase: "reconnecting", error: "timed out", traceId: null } }),
    ).toEqual({ kind: "disconnected", detail: "timed out" });
  });

  it("keeps stale content marked as disconnected after the socket drops", () => {
    expect(view("cached")).toEqual({ kind: "disconnected", detail: null });
    expect(view("synchronizing")).toEqual({ kind: "reconnecting" });
  });

  it("reports a missing thread as disconnected rather than loading when the server is unreachable", () => {
    expect(view("empty", { hasData: false })).toEqual({ kind: "loading" });
    expect(
      view("empty", {
        hasData: false,
        connection: { phase: "error", error: "Session revoked", traceId: null },
      }),
    ).toEqual({ kind: "disconnected", detail: "Session revoked" });
  });

  it("surfaces deletion and load failures over everything else", () => {
    expect(view("deleted", { hasData: false })).toEqual({ kind: "deleted" });
    expect(view("live", { failure: "Snapshot failed" })).toEqual({
      kind: "failed",
      detail: "Snapshot failed",
    });
  });
});
