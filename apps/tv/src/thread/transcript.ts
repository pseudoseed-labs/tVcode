import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export type TranscriptRow =
  | { readonly key: string; readonly kind: "user" | "assistant"; readonly text: string }
  | {
      readonly key: string;
      readonly kind: "command";
      readonly text: string;
      readonly output: string;
      readonly failed: boolean;
    }
  | {
      readonly key: string;
      readonly kind: "note";
      readonly text: string;
      readonly tone: "muted" | "warning" | "error";
    };

const OUTPUT_TAIL_LINES = 8;

function tail(text: string, lines: number): string {
  const all = text.trimEnd().split(/\r?\n/);
  return all.slice(-lines).join("\n");
}

type FileChangeItem = Extract<
  OrchestrationV2ThreadProjection["visibleTurnItems"][number]["item"],
  { readonly type: "file_change" }
>;

function fileChangeNote(item: FileChangeItem): {
  readonly text: string;
  readonly tone: "muted" | "warning" | "error";
} {
  switch (item.status) {
    case "completed":
      return {
        tone: "muted",
        text: `Edited ${item.fileName}${item.additions !== undefined ? ` +${item.additions}` : ""}${item.deletions !== undefined ? ` −${item.deletions}` : ""}`,
      };
    case "pending":
    case "running":
    case "waiting":
      return { tone: "muted", text: `Editing ${item.fileName}` };
    case "failed":
      // Providers mark a tool the user or a permission rule refused as a non-execution.
      return item.toolNonExecutionKind === undefined
        ? { tone: "error", text: `Edit failed: ${item.fileName}` }
        : { tone: "warning", text: `Declined edit to ${item.fileName}` };
    case "idle":
    case "cancelled":
    case "interrupted":
      return { tone: "muted", text: `Edit stopped: ${item.fileName}` };
  }
}

/** The last `limit` rows a couch viewer cares about: messages, commands, edits, requests, errors. */
export function transcriptRows(
  projection: OrchestrationV2ThreadProjection,
  limit: number,
): TranscriptRow[] {
  const messageText = new Map(projection.messages.map((message) => [message.id, message.text]));
  const rows: TranscriptRow[] = [];
  for (const { item, sourceItemId } of projection.visibleTurnItems) {
    const key = String(sourceItemId);
    switch (item.type) {
      case "user_message":
      case "assistant_message": {
        const text = item.text || messageText.get(item.messageId) || "";
        if (text.trim()) {
          rows.push({ key, kind: item.type === "user_message" ? "user" : "assistant", text });
        }
        break;
      }
      case "command_execution":
        rows.push({
          key,
          kind: "command",
          text: item.input,
          output: item.outputOmitted ? "" : tail(item.output ?? "", OUTPUT_TAIL_LINES),
          failed: item.outputIndicatesFailure === true || (item.exitCode ?? 0) !== 0,
        });
        break;
      case "file_change":
        rows.push({ key, kind: "note", ...fileChangeNote(item) });
        break;
      case "approval_request":
        rows.push({
          key,
          kind: "note",
          tone: "warning",
          text: item.prompt ?? "Approval requested",
        });
        break;
      case "user_input_request":
        rows.push({
          key,
          kind: "note",
          tone: "warning",
          text: item.questions.map((question) => `Question: ${question.question}`).join("\n"),
        });
        break;
      case "error":
        rows.push({ key, kind: "note", tone: "error", text: item.failure.message });
        break;
      default:
        break;
    }
  }
  return rows.slice(-limit);
}
