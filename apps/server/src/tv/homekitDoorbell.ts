// @effect-diagnostics nodeBuiltinImport:off -- adapter around hap-nodejs, which is callback based.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  Accessory,
  DoorbellController,
  HAPStorage,
  uuid,
  type CameraStreamingDelegate,
  type Categories,
  type H264Level,
  type H264Profile,
  type PrepareStreamCallback,
  type PrepareStreamRequest,
  type SnapshotRequest,
  type SnapshotRequestCallback,
  type SRTPCryptoSuites,
  type StreamingRequest,
  type StreamRequestCallback,
} from "hap-nodejs";

import { startCardRenderer, type CardRenderer } from "./cardRenderer.ts";
import {
  buildDoorbellCardSvg,
  CARD_HEIGHT,
  CARD_WIDTH,
  type DoorbellCardInput,
} from "./doorbellCard.ts";

// hap-nodejs declares these as ambient const enums, which isolatedModules cannot read.
const VIDEO_DOORBELL = 18 as Categories;
const AES_CM_128_HMAC_SHA1_80 = 0 as SRTPCryptoSuites;
const H264_PROFILES = [0, 1, 2] as H264Profile[];
const H264_LEVELS = [0, 1, 2] as H264Level[];
/** Controllers ask for a few fixed sizes; a cap keeps an odd one from growing the cache. */
const MAX_CACHED_SIZES = 4;

/** hap-nodejs passes controller-supplied sizes through without checking them. */
export const boundedInt = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

export interface DoorbellIdentity {
  readonly username: string;
  readonly pincode: string;
  readonly setupId: string;
}

const TRIVIAL_PINS = new Set([
  "12345678",
  "87654321",
  ...Array.from({ length: 10 }, (_, digit) => String(digit).repeat(8)),
]);

export function generateDoorbellIdentity(): DoorbellIdentity {
  const mac = [...NodeCrypto.randomBytes(6)];
  // Locally administered, unicast.
  mac[0] = ((mac[0] ?? 0) | 0x02) & 0xfe;
  let digits = "";
  do digits = Array.from({ length: 8 }, () => NodeCrypto.randomInt(10)).join("");
  while (TRIVIAL_PINS.has(digits));
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return {
    username: mac.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(":"),
    pincode: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`,
    setupId: Array.from({ length: 4 }, () => alphabet[NodeCrypto.randomInt(alphabet.length)]).join(
      "",
    ),
  };
}

/** Serves the latest status card as HomeKit snapshots, which is what Apple TV's picture-in-picture shows. */
export class CardCamera implements CameraStreamingDelegate {
  private card: DoorbellCardInput;
  private cardVersion = 0;
  private lastSize = { width: CARD_WIDTH, height: CARD_HEIGHT };
  private readonly cache = new Map<string, Buffer>();
  private inFlight: { readonly key: string; readonly jpeg: Promise<Buffer> } | null = null;
  private readonly renderer: Pick<CardRenderer, "render">;
  private readonly log: (message: string) => void;

  constructor(
    renderer: Pick<CardRenderer, "render">,
    card: DoorbellCardInput,
    log: (message: string) => void,
  ) {
    this.renderer = renderer;
    this.card = card;
    this.log = log;
  }

  /** Swaps the card and renders it at the last requested size, so the next snapshot is instant. */
  showCard(card: DoorbellCardInput): Promise<void> {
    this.card = card;
    this.cardVersion++;
    this.cache.clear();
    return this.snapshot(this.lastSize.width, this.lastSize.height).then(() => undefined);
  }

  // Home polls snapshots every few seconds while visible: serve the cached JPEG, share one render
  // per card and size, and keep at most one render in flight.
  private snapshot(width: number, height: number): Promise<Buffer> {
    const key = `${this.cardVersion}:${width}x${height}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (this.inFlight?.key === key) return this.inFlight.jpeg;
    if (this.inFlight) {
      const fallback = this.cache.values().next().value;
      return fallback ? Promise.resolve(fallback) : this.inFlight.jpeg;
    }
    const version = this.cardVersion;
    const jpeg = this.renderer.render(buildDoorbellCardSvg(this.card, { width, height }));
    const inFlight = { key, jpeg };
    this.inFlight = inFlight;
    const settle = () => {
      if (this.inFlight === inFlight) this.inFlight = null;
    };
    jpeg.then((image) => {
      settle();
      if (version !== this.cardVersion) return;
      if (this.cache.size >= MAX_CACHED_SIZES) this.cache.clear();
      this.cache.set(key, image);
    }, settle);
    return jpeg;
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
    const width = boundedInt(request.width, 16, 3840);
    const height = boundedInt(request.height, 16, 2160);
    if (width === null || height === null) return callback(new Error("Invalid snapshot size."));
    this.lastSize = { width, height };
    this.snapshot(width, height).then(
      (jpeg) => callback(undefined, jpeg),
      (error: unknown) => {
        this.log(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
        callback(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  // HomeKit requires a doorbell to offer video, but the picture-in-picture card only uses
  // snapshots. Refusing here makes full-screen video fail cleanly instead of hanging.
  prepareStream(_request: PrepareStreamRequest, callback: PrepareStreamCallback) {
    callback(new Error("Live video is not supported."));
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback) {
    if (request.type === "start") return callback(new Error("Live video is not supported."));
    callback();
  }
}

export interface DoorbellHandle {
  readonly setupUri: string;
  readonly paired: () => boolean;
  readonly ring: () => void;
  readonly showCard: (card: DoorbellCardInput) => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface PublishDoorbellInput {
  readonly storageDir: string;
  readonly identity: DoorbellIdentity;
  readonly name: string;
  readonly card: DoorbellCardInput;
  readonly onPairingChange: () => void;
  readonly log: (message: string) => void;
  readonly platform: NodeJS.Platform;
}

let configuredStorageDir: string | null = null;

/**
 * hap-nodejs keeps one process-wide store and throws if its path is set twice. The store holds
 * the accessory's signing key and setup code, so keep its folder owner-only.
 */
async function useStorage(storageDir: string, platform: NodeJS.Platform) {
  await NodeFSP.mkdir(storageDir, { recursive: true, mode: 0o700 });
  if (platform !== "win32") {
    await NodeFSP.chmod(storageDir, 0o700);
    for (const entry of await NodeFSP.readdir(storageDir))
      await NodeFSP.chmod(NodePath.join(storageDir, entry), 0o600).catch(() => undefined);
  }
  if (configuredStorageDir === storageDir) return;
  if (configuredStorageDir !== null)
    throw new Error(`HomeKit storage is already at ${configuredStorageDir}.`);
  HAPStorage.setCustomStoragePath(storageDir);
  configuredStorageDir = storageDir;
}

export async function publishDoorbell(input: PublishDoorbellInput): Promise<DoorbellHandle> {
  await useStorage(input.storageDir, input.platform);
  const renderer = await startCardRenderer();
  try {
    return await publishWithRenderer(input, renderer);
  } catch (error) {
    await renderer.stop();
    throw error;
  }
}

async function publishWithRenderer(
  input: PublishDoorbellInput,
  renderer: CardRenderer,
): Promise<DoorbellHandle> {
  const camera = new CardCamera(renderer, input.card, input.log);
  // Fails the start if the renderer cannot run here, before HomeKit ever sees the accessory.
  await camera.showCard(input.card);
  const accessory = new Accessory(
    input.name,
    uuid.generate(`t3code:tv-doorbell:${input.identity.username}`),
  );
  accessory.category = VIDEO_DOORBELL;
  const controller = new DoorbellController({
    cameraStreamCount: 2,
    delegate: camera,
    streamingOptions: {
      supportedCryptoSuites: [AES_CM_128_HMAC_SHA1_80],
      video: {
        codec: { profiles: H264_PROFILES, levels: H264_LEVELS },
        resolutions: [
          [1920, 1080, 30],
          [1280, 720, 30],
          [640, 360, 30],
          [480, 270, 30],
          [320, 240, 15],
          [320, 180, 30],
        ],
      },
    },
  });
  accessory.configureController(controller);
  accessory.on("paired", input.onPairingChange);
  accessory.on("unpaired", input.onPairingChange);
  await accessory.publish({
    username: input.identity.username,
    pincode: input.identity.pincode,
    setupID: input.identity.setupId,
    category: VIDEO_DOORBELL,
  });
  return {
    setupUri: accessory.setupURI(),
    paired: () => accessory._accessoryInfo?.paired() ?? false,
    ring: () => controller.ringDoorbell(),
    showCard: (card) => camera.showCard(card),
    // unpublish, not destroy: destroy deletes the pairing, and turning the setting off must not.
    stop: async () => {
      accessory.removeAllListeners();
      await Promise.all([accessory.unpublish(), renderer.stop()]);
    },
  };
}

/** Deletes the pairing and identifiers stored for an identity. Call while it is unpublished. */
export async function forgetDoorbellPairing(
  storageDir: string,
  identity: DoorbellIdentity,
  platform: NodeJS.Platform,
) {
  await useStorage(storageDir, platform);
  Accessory.cleanupAccessoryData(identity.username);
}
