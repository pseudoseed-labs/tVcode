import type { SnapshotRequest } from "hap-nodejs";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vite-plus/test";
import { startCardRenderer } from "./cardRenderer.ts";
import {
  buildDoorbellCardSvg,
  clip,
  compactAge,
  wrapLines,
  type DoorbellCardInput,
} from "./doorbellCard.ts";
import { boundedInt, CardCamera, generateDoorbellIdentity } from "./homekitDoorbell.ts";
import { ringReasonForTransition } from "./TvDoorbell.ts";

const all = {
  tvDoorbellEnabled: true,
  tvDoorbellRingOnNeedsYou: true,
  tvDoorbellRingOnCompleted: true,
  tvDoorbellRingOnFailed: true,
};
const running = { phase: "running", requestId: null } as const;
const card: DoorbellCardInput = {
  status: "completed",
  threadTitle: "Fix sidebar flicker",
  projectTitle: "web",
  branch: "main",
  age: "now",
};

describe("TV doorbell ring rules", () => {
  it("rings once per new approval or input request, not again while it stays pending", () => {
    const waiting = { phase: "waiting_for_approval", requestId: "request-1" } as const;
    expect(ringReasonForTransition(running, waiting, all)).toBe("needs-you");
    expect(ringReasonForTransition(waiting, waiting, all)).toBeNull();
    expect(
      ringReasonForTransition(waiting, { phase: "waiting_for_input", requestId: "request-2" }, all),
    ).toBe("needs-you");
  });

  it("stays quiet for requests the thread does not wait on, and rings once they block", () => {
    const authRefresh = { phase: "running", requestId: "auth-1" } as const;
    expect(ringReasonForTransition(running, authRefresh, all)).toBeNull();
    const nonBlocking = { phase: "running", requestId: "question-1" } as const;
    expect(ringReasonForTransition(running, nonBlocking, all)).toBeNull();
    expect(
      ringReasonForTransition(
        nonBlocking,
        { phase: "waiting_for_input", requestId: "question-1" },
        all,
      ),
    ).toBe("needs-you");
  });

  it("rings when a run finishes or fails, but not for threads first seen in that state", () => {
    expect(ringReasonForTransition(running, { phase: "completed", requestId: null }, all)).toBe(
      "completed",
    );
    expect(ringReasonForTransition(running, { phase: "failed", requestId: null }, all)).toBe(
      "failed",
    );
    expect(
      ringReasonForTransition(undefined, { phase: "completed", requestId: null }, all),
    ).toBeNull();
    expect(ringReasonForTransition(running, { phase: "running", requestId: null }, all)).toBeNull();
  });

  it("respects each ring toggle", () => {
    const quiet = {
      ...all,
      tvDoorbellRingOnNeedsYou: false,
      tvDoorbellRingOnCompleted: false,
      tvDoorbellRingOnFailed: false,
    };
    expect(
      ringReasonForTransition(running, { phase: "waiting_for_input", requestId: "r" }, quiet),
    ).toBeNull();
    expect(
      ringReasonForTransition(running, { phase: "completed", requestId: null }, quiet),
    ).toBeNull();
    expect(
      ringReasonForTransition(running, { phase: "failed", requestId: null }, quiet),
    ).toBeNull();
  });
});

describe("TV doorbell card", () => {
  it("escapes thread text so a title cannot break the SVG", () => {
    const svg = buildDoorbellCardSvg({
      ...card,
      threadTitle: `Fix <script> & "quotes"`,
      projectTitle: "<web>",
      branch: "feat/a&b",
    });
    expect(svg).toContain("Fix &#60;script&#62; &#38; &#34;quotes&#34;");
    expect(svg).toContain("&#60;web&#62;");
    expect(svg).toContain("feat/a&#38;b");
    expect(svg).not.toContain("<script>");
  });

  it("clips long titles on code point boundaries", () => {
    expect(clip("a".repeat(40), 10)).toBe(`${"a".repeat(9)}…`);
    expect([...clip("🚀".repeat(20), 5)]).toHaveLength(5);
  });

  it("wraps titles at word boundaries into at most two lines", () => {
    expect(wrapLines("Migrate the billing webhooks to the new queue", 25, 2)).toEqual([
      "Migrate the billing",
      "webhooks to the new queue",
    ]);
    expect(wrapLines("short", 25, 2)).toEqual(["short"]);
    expect(wrapLines("x".repeat(60), 25, 2)).toEqual(["x".repeat(25), `${"x".repeat(24)}…`]);
  });

  it("labels each status the way the sidebar does", () => {
    expect(buildDoorbellCardSvg({ ...card, status: "pending-approval" })).toContain(
      "Pending Approval",
    );
    expect(buildDoorbellCardSvg({ ...card, status: "awaiting-input" })).toContain("Awaiting Input");
    expect(buildDoorbellCardSvg({ ...card, status: "completed" })).toContain("Completed");
    expect(buildDoorbellCardSvg({ ...card, status: "failed" })).toContain("Failed");
  });

  it("shows ages like the sidebar", () => {
    expect(compactAge(30_000)).toBe("now");
    expect(compactAge(12 * 60_000)).toBe("12m");
    expect(compactAge(3 * 3_600_000)).toBe("3h");
    expect(compactAge(50 * 3_600_000)).toBe("2d");
  });

  it("renders a JPEG of the requested size off the event loop", async () => {
    const renderer = await startCardRenderer();
    try {
      const image = jpeg.decode(
        await renderer.render(buildDoorbellCardSvg(card, { width: 640, height: 360 })),
      );
      expect([image.width, image.height]).toEqual([640, 360]);
    } finally {
      await renderer.stop();
    }
  });
});

describe("TV doorbell identity", () => {
  it("produces a HomeKit-valid setup code and a unicast, locally administered id", () => {
    for (let index = 0; index < 50; index++) {
      const identity = generateDoorbellIdentity();
      expect(identity.pincode).toMatch(/^\d{3}-\d{2}-\d{3}$/);
      expect(["12345678", "87654321"]).not.toContain(identity.pincode.replaceAll("-", ""));
      expect(identity.setupId).toMatch(/^[0-9A-Z]{4}$/);
      const firstOctet = Number.parseInt(identity.username.slice(0, 2), 16);
      expect(firstOctet & 0x01).toBe(0);
      expect(firstOctet & 0x02).toBe(2);
    }
  });
});

describe("TV doorbell host integration", () => {
  it("rejects controller-supplied numbers that are not bounded integers", () => {
    expect(boundedInt(1280, 16, 3840)).toBe(1280);
    expect(boundedInt("1280:flags=x", 16, 3840)).toBeNull();
    expect(boundedInt(12.5, 16, 3840)).toBeNull();
    expect(boundedInt(99_999, 16, 3840)).toBeNull();
  });

  it("renders each card and size once, sharing a render between concurrent snapshots", async () => {
    const rendered: string[] = [];
    const camera = new CardCamera(
      {
        render: async (svg) => {
          rendered.push(svg);
          return Buffer.from(String(rendered.length));
        },
      },
      card,
      () => undefined,
    );
    const snapshot = (width: number, height: number) =>
      new Promise<string>((resolve, reject) =>
        camera.handleSnapshotRequest({ width, height } as SnapshotRequest, (error, image) =>
          error ? reject(error) : resolve(String(image)),
        ),
      );
    expect(await Promise.all([snapshot(1280, 720), snapshot(1280, 720)])).toEqual(["1", "1"]);
    expect(await snapshot(1280, 720)).toBe("1");
    await camera.showCard({ ...card, status: "failed" });
    expect(await snapshot(1280, 720)).toBe("2");
    expect(rendered).toHaveLength(2);
    await expect(snapshot(1280.5, 720)).rejects.toThrow("Invalid snapshot size.");
  });

  it("refuses live video so full screen fails instead of hanging", async () => {
    const camera = new CardCamera({ render: async () => Buffer.alloc(0) }, card, () => undefined);
    const error = await new Promise<Error | undefined>((resolve) =>
      camera.prepareStream({} as Parameters<CardCamera["prepareStream"]>[0], resolve),
    );
    expect(error?.message).toBe("Live video is not supported.");
  });
});
