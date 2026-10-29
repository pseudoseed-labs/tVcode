import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import {
  derivePendingThreadRequests,
  type ThreadPendingApproval,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { ProviderApprovalDecision, ProviderApprovalOption } from "@t3tools/contracts";

export interface ApprovalChoice {
  readonly decision: ProviderApprovalDecision;
  readonly label: string;
  readonly warning?: string;
  readonly tone: "primary" | "danger" | "neutral";
}

const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "accept", label: "Approve" },
  { decision: "decline", label: "Deny" },
];

function decisionTone(decision: ProviderApprovalDecision): ApprovalChoice["tone"] {
  switch (decision) {
    case "accept":
      return "primary";
    case "decline":
    case "cancel":
      return "danger";
    case "acceptForSession":
    case "acceptAlways":
      return "neutral";
  }
}

/** The provider's own options when it sent any; a provider rejects decisions it did not offer. */
export function approvalChoices(
  options: ReadonlyArray<ProviderApprovalOption> | undefined,
): ApprovalChoice[] {
  return (options?.length ? options : DEFAULT_APPROVAL_OPTIONS).map((option) => ({
    ...option,
    tone: decisionTone(option.decision),
  }));
}

export type PendingDecision =
  | { readonly kind: "approval"; readonly approval: ThreadPendingApproval }
  | { readonly kind: "question"; readonly input: ThreadPendingUserInput };

/** What the thread waits on: an answerable approval first, then a question, then a dead approval. */
export function pendingDecision(
  projection: Parameters<typeof derivePendingThreadRequests>[0],
): PendingDecision | null {
  const { approvals, userInputs } = derivePendingThreadRequests(projection);
  const live = approvals.find((approval) => approval.responseCapability === "live");
  if (live !== undefined) return { kind: "approval", approval: live };
  if (userInputs[0] !== undefined) return { kind: "question", input: userInputs[0] };
  return approvals[0] === undefined ? null : { kind: "approval", approval: approvals[0] };
}

export interface QuestionDraft {
  readonly selected: ReadonlyArray<string>;
  readonly custom: string;
}

type Question = ThreadPendingUserInput["questions"][number];

/** Providers match answers on the option's value, falling back to its label. */
export function optionValue(option: Question["options"][number]): string {
  return option.value ?? option.label;
}

export function initialDraft(question: Question): QuestionDraft {
  const custom = question.allowCustomAnswer === false ? "" : (question.initialAnswer ?? "");
  return { selected: [], custom };
}

/** Picking an option clears a typed answer, as in T3 Code. */
export function toggleOption(
  question: Question,
  draft: QuestionDraft,
  value: string,
): QuestionDraft {
  if (!question.multiSelect) return { selected: [value], custom: "" };
  const selected = draft.selected.includes(value)
    ? draft.selected.filter((entry) => entry !== value)
    : [...draft.selected, value];
  return { selected, custom: "" };
}

/** A typed answer wins over picked options; null while the question is unanswered. */
export function questionAnswer(question: Question, draft: QuestionDraft): string | string[] | null {
  const custom = question.allowCustomAnswer === false ? "" : draft.custom.trim();
  if (custom !== "") return custom;
  const offered = new Set(question.options.map(optionValue));
  const selected = draft.selected.filter((value) => offered.has(value));
  if (question.multiSelect) return selected.length > 0 ? [...selected] : null;
  return selected[0] ?? null;
}

export function questionAnswers(
  questions: ThreadPendingUserInput["questions"],
  drafts: Readonly<Record<string, QuestionDraft>>,
): Record<string, string | string[]> | null {
  const answers: Record<string, string | string[]> = {};
  for (const question of questions) {
    const answer = questionAnswer(question, drafts[question.id] ?? initialDraft(question));
    if (answer === null) return null;
    answers[question.id] = answer;
  }
  return answers;
}

export type ThreadViewStatus =
  | { readonly kind: "live" }
  | { readonly kind: "loading" }
  | { readonly kind: "reconnecting" }
  | { readonly kind: "disconnected"; readonly detail: string | null }
  | { readonly kind: "failed"; readonly detail: string }
  | { readonly kind: "deleted" };

/** Decisions are only safe to send while the thread is live on a connected environment. */
export function threadViewStatus(input: {
  readonly status: EnvironmentThreadStatus;
  readonly hasData: boolean;
  readonly failure: string | null;
  readonly connection: EnvironmentConnectionPresentation;
}): ThreadViewStatus {
  const { status, connection } = input;
  if (status === "deleted") return { kind: "deleted" };
  if (input.failure !== null) return { kind: "failed", detail: input.failure };
  if (status === "live" && connection.phase === "connected") return { kind: "live" };
  switch (connection.phase) {
    case "offline":
    case "reconnecting":
    case "error":
    case "unsupported":
      return { kind: "disconnected", detail: connection.error };
    case "available":
    case "connecting":
    case "connected":
      if (status === "cached") return { kind: "disconnected", detail: null };
      return input.hasData ? { kind: "reconnecting" } : { kind: "loading" };
  }
}
