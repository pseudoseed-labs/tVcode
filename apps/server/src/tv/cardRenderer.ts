// @effect-diagnostics nodeBuiltinImport:off -- owns a worker thread that hap-nodejs callbacks reach outside any fiber.
// @effect-diagnostics globalTimers:off -- render timeouts run outside any fiber.
import * as NodeModule from "node:module";
import * as NodeWorkerThreads from "node:worker_threads";

const RENDER_TIMEOUT_MS = 10_000;
const JPEG_QUALITY = 85;

// Evaluated rather than loaded from a file so the bundled server needs no extra entry. Paths
// arrive resolved, because an eval worker resolves bare specifiers from the working directory.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const { Resvg, initWasm } = require(workerData.resvgPath);
const jpeg = require(workerData.jpegPath);
const fontBuffers = workerData.fonts.map((font) => Buffer.from(font, "base64"));
const ready = initWasm(readFileSync(workerData.wasmPath));
parentPort.on("message", async ({ id, svg, quality }) => {
  try {
    await ready;
    const resvg = new Resvg(svg, { font: { fontBuffers, defaultFontFamily: "DM Sans" } });
    const image = resvg.render();
    const { width, height, pixels } = image;
    image.free();
    resvg.free();
    const { data } = jpeg.encode({ data: pixels, width, height }, quality);
    parentPort.postMessage({ id, jpeg: data });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

type Reply = { id: number; jpeg: Uint8Array } | { id: number; error: string };

export interface CardRenderer {
  /** SVG to JPEG on the worker thread, at the SVG's own width and height. */
  readonly render: (svg: string) => Promise<Buffer>;
  readonly stop: () => Promise<void>;
}

/** Starts the worker once the doorbell turns on; a crashed worker is replaced on the next render. */
export async function startCardRenderer(): Promise<CardRenderer> {
  const resolver = NodeModule.createRequire(import.meta.url);
  const { DM_SANS_FONTS_BASE64 } = await import("./doorbellFonts.ts");
  const workerData = {
    resvgPath: resolver.resolve("@resvg/resvg-wasm"),
    wasmPath: resolver.resolve("@resvg/resvg-wasm/index_bg.wasm"),
    jpegPath: resolver.resolve("jpeg-js"),
    fonts: DM_SANS_FONTS_BASE64,
  };
  const pending = new Map<
    number,
    {
      readonly owner: NodeWorkerThreads.Worker;
      readonly resolve: (jpeg: Buffer) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  let nextId = 0;
  let worker: NodeWorkerThreads.Worker | null = null;
  let stopped = false;

  const failAll = (owner: NodeWorkerThreads.Worker | null, error: Error) => {
    for (const [id, request] of pending) {
      if (owner !== null && request.owner !== owner) continue;
      pending.delete(id);
      request.reject(error);
    }
  };
  const spawn = () => {
    const current = new NodeWorkerThreads.Worker(WORKER_SOURCE, { eval: true, workerData });
    // Never the reason the server stays alive; stop() still terminates it.
    current.unref();
    current.on("message", (reply: Reply) => {
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      if ("error" in reply) request.reject(new Error(reply.error));
      else
        request.resolve(Buffer.from(reply.jpeg.buffer, reply.jpeg.byteOffset, reply.jpeg.length));
    });
    current.on("error", (error) => failAll(current, error));
    current.on("exit", (code) => {
      if (worker === current) worker = null;
      failAll(current, new Error(`Card renderer exited with code ${code}.`));
    });
    return current;
  };

  const render = (svg: string) =>
    new Promise<Buffer>((resolve, reject) => {
      if (stopped) return reject(new Error("Card renderer is stopped."));
      worker ??= spawn();
      const current = worker;
      const id = nextId++;
      const timer = setTimeout(() => {
        reject(new Error("Card render timed out."));
        pending.delete(id);
        if (worker === current) worker = null;
        void current.terminate();
      }, RENDER_TIMEOUT_MS);
      pending.set(id, {
        owner: current,
        resolve: (jpeg) => {
          clearTimeout(timer);
          resolve(jpeg);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
      current.postMessage({ id, svg, quality: JPEG_QUALITY });
    });

  return {
    render,
    stop: async () => {
      stopped = true;
      const current = worker;
      worker = null;
      failAll(null, new Error("Card renderer is stopped."));
      if (current) await current.terminate();
    },
  };
}
