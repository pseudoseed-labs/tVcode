import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { transcriptRows } from "./transcript.ts";

function fileChange(id: string, fields: Record<string, unknown>) {
  return {
    sourceItemId: id,
    item: { type: "file_change", fileName: "README.md", ...fields },
  };
}

function projection(visibleTurnItems: ReadonlyArray<ReturnType<typeof fileChange>>) {
  // The transcript reads only messages and visible turn items.
  return { messages: [], visibleTurnItems } as unknown as OrchestrationV2ThreadProjection;
}

describe("transcriptRows", () => {
  it("labels file changes by whether the edit happened", () => {
    const rows = transcriptRows(
      projection([
        fileChange("applied", { status: "completed", additions: 2, deletions: 1 }),
        fileChange("declined", { status: "failed", toolNonExecutionKind: "permission-rule" }),
        fileChange("failed", { status: "failed" }),
        fileChange("running", { status: "running" }),
      ]),
      10,
    );

    expect(rows.map((row) => [row.text, row.kind === "note" ? row.tone : null])).toEqual([
      ["Edited README.md +2 −1", "muted"],
      ["Declined edit to README.md", "warning"],
      ["Edit failed: README.md", "error"],
      ["Editing README.md", "muted"],
    ]);
  });

  it("shows the agent's questions to the user", () => {
    const rows = transcriptRows(
      projection([
        {
          sourceItemId: "ask",
          item: {
            type: "user_input_request",
            questions: [{ question: "Which database?" }, { question: "Keep the old schema?" }],
          },
        } as unknown as ReturnType<typeof fileChange>,
      ]),
      10,
    );

    expect(rows).toEqual([
      {
        key: "ask",
        kind: "note",
        tone: "warning",
        text: "Question: Which database?\nQuestion: Keep the old schema?",
      },
    ]);
  });
});
