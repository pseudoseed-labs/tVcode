import {
  TvDoorbellError,
  type ServerSettings,
  type ThreadId,
  type TvDoorbellRing,
  type TvDoorbellRingReason,
  type TvDoorbellStatus,
} from "@t3tools/contracts";
import { projectThreadAwarenessV2, type AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { eventThreadId, shouldPublishAgentAwarenessEvent } from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { compactAge, type DoorbellCardInput } from "./doorbellCard.ts";
import type { DoorbellHandle, DoorbellIdentity } from "./homekitDoorbell.ts";

// hap-nodejs and the renderer load only once the doorbell is on, so they cost nothing while off.
const loadHomekit = () => import("./homekitDoorbell.ts");

const ACCESSORY_NAME = "T3 Code";
const IDENTITY_KEY = "tv-doorbell-identity";
/** Rings closer together than this collapse into one showing the newest card. */
const RING_SPACING = "5 seconds";

const RESTING_CARD: DoorbellCardInput = {
  status: null,
  threadTitle: "Waiting for threads",
  projectTitle: "",
  branch: null,
  age: null,
};

interface Ring {
  readonly reason: TvDoorbellRingReason;
  readonly card: DoorbellCardInput;
}

const IdentityJson = Schema.fromJsonString(
  Schema.Struct({ username: Schema.String, pincode: Schema.String, setupId: Schema.String }),
);
const decodeIdentity = Schema.decodeUnknownEffect(IdentityJson);
const encodeIdentity = Schema.encodeEffect(IdentityJson);

type RingSettings = Pick<
  ServerSettings,
  | "tvDoorbellEnabled"
  | "tvDoorbellRingOnNeedsYou"
  | "tvDoorbellRingOnCompleted"
  | "tvDoorbellRingOnFailed"
>;

const attempt = <A>(label: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new TvDoorbellError({
        message: `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

interface ThreadMemory {
  readonly phase: AgentAwarenessState["phase"] | null;
  readonly requestId: string | null;
}

const isWaiting = (phase: ThreadMemory["phase"] | undefined) =>
  phase === "waiting_for_input" || phase === "waiting_for_approval";

/**
 * Which ring, if any, a thread's move from `previous` to `next` deserves. Needs-you follows the
 * shared awareness phase, so auth refreshes and non-blocking questions stay quiet until they block.
 */
export function ringReasonForTransition(
  previous: ThreadMemory | undefined,
  next: ThreadMemory,
  settings: RingSettings,
): Exclude<TvDoorbellRingReason, "test"> | null {
  if (isWaiting(next.phase)) {
    const isNew =
      previous === undefined || !isWaiting(previous.phase) || previous.requestId !== next.requestId;
    return isNew && settings.tvDoorbellRingOnNeedsYou ? "needs-you" : null;
  }
  if (previous === undefined || previous.phase === next.phase) return null;
  if (next.phase === "completed") return settings.tvDoorbellRingOnCompleted ? "completed" : null;
  if (next.phase === "failed") return settings.tvDoorbellRingOnFailed ? "failed" : null;
  return null;
}

export class TvDoorbell extends Context.Service<
  TvDoorbell,
  {
    readonly changes: Stream.Stream<TvDoorbellStatus>;
    readonly testRing: Effect.Effect<TvDoorbellStatus, TvDoorbellError>;
    readonly resetPairing: Effect.Effect<TvDoorbellStatus, TvDoorbellError>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/tv/TvDoorbell") {}

const OFF_STATUS: TvDoorbellStatus = {
  state: "off",
  paired: false,
  accessoryName: ACCESSORY_NAME,
  setupCode: null,
  setupUri: null,
  lastRing: null,
  message: null,
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const query = yield* ThreadManagementService;
  const projectService = yield* ProjectService;
  const environment = yield* ServerEnvironment;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const storageDir = path.join(config.stateDir, "homekit");

  const status = yield* SubscriptionRef.make<TvDoorbellStatus>(OFF_STATUS);
  const lifecycle = yield* Semaphore.make(1);
  // Every card change and ring goes through here; take it after `lifecycle`, never before.
  const cardLock = yield* Semaphore.make(1);
  const rings = yield* Queue.sliding<Ring>(1);
  const memory = new Map<ThreadId, ThreadMemory>();
  let handle: DoorbellHandle | null = null;
  let identity: DoorbellIdentity | null = null;
  let settings: RingSettings = yield* settingsService.getSettings.pipe(
    Effect.orElseSucceed(() => ({
      tvDoorbellEnabled: false,
      tvDoorbellRingOnNeedsYou: true,
      tvDoorbellRingOnCompleted: true,
      tvDoorbellRingOnFailed: true,
    })),
  );

  const updateStatus = (patch: Partial<TvDoorbellStatus>) =>
    SubscriptionRef.update(status, (current) => ({
      ...current,
      ...patch,
      paired: handle?.paired() ?? false,
    }));
  // hap-nodejs emits pairing changes from its own sockets, outside any fiber.
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  const loadIdentity = Effect.gen(function* () {
    if (identity) return identity;
    const stored = yield* secrets.get(IDENTITY_KEY);
    if (Option.isSome(stored)) {
      identity = yield* decodeIdentity(new TextDecoder().decode(stored.value));
      return identity;
    }
    const fresh = (yield* attempt("load HomeKit", loadHomekit)).generateDoorbellIdentity();
    yield* secrets.set(IDENTITY_KEY, new TextEncoder().encode(yield* encodeIdentity(fresh)));
    identity = fresh;
    return fresh;
  });

  const hydrateMemory = Effect.gen(function* () {
    memory.clear();
    const snapshot = yield* query.getShellSnapshot();
    const environmentId = yield* environment.getEnvironmentId;
    const projects = new Map(
      (yield* projectService.snapshot).projects.map((project) => [project.id, project]),
    );
    for (const thread of snapshot.threads) {
      const project = projects.get(thread.projectId);
      const state = project ? projectThreadAwarenessV2({ environmentId, project, thread }) : null;
      memory.set(thread.id, {
        phase: state?.phase ?? null,
        requestId: thread.pendingRuntimeRequest?.id ?? null,
      });
    }
  });

  const startDoorbell = Effect.gen(function* () {
    yield* updateStatus({ state: "starting", message: null });
    const id = yield* loadIdentity;
    handle = yield* attempt("publish HomeKit accessory", async () =>
      (await loadHomekit()).publishDoorbell({
        storageDir,
        identity: id,
        name: ACCESSORY_NAME,
        card: RESTING_CARD,
        platform,
        onPairingChange: () => void runFork(updateStatus({})),
        log: (message) => void runFork(Effect.logInfo(`TV doorbell camera: ${message}`)),
      }),
    );
    yield* hydrateMemory.pipe(
      Effect.catch(() =>
        Effect.logWarning("TV doorbell could not read the starting thread states."),
      ),
    );
    yield* updateStatus({
      state: "ready",
      setupCode: id.pincode,
      setupUri: handle.setupUri,
      message: null,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("TV doorbell failed to start.").pipe(
        Effect.annotateLogs({ error: error.message }),
        Effect.andThen(
          updateStatus({
            state: "unavailable",
            message: "The HomeKit doorbell could not start. Check the server log for details.",
          }),
        ),
      ),
    ),
  );

  const stopDoorbell = Effect.gen(function* () {
    const current = handle;
    handle = null;
    memory.clear();
    if (current) yield* Effect.promise(() => current.stop().catch(() => undefined));
    yield* SubscriptionRef.set(status, OFF_STATUS);
  });

  // Reads `settings` when it runs, so a late initial pass cannot undo a newer change.
  const reconcile = lifecycle.withPermit(
    Effect.gen(function* () {
      if (settings.tvDoorbellEnabled && !handle) yield* startDoorbell;
      else if (!settings.tvDoorbellEnabled && handle) yield* stopDoorbell;
    }),
  );

  const ringNow = Effect.fn("TvDoorbell.ringNow")(function* ({ reason, card }: Ring) {
    const current = handle;
    if (!current) return;
    yield* attempt("render card", () => current.showCard(card));
    if (handle !== current) return;
    current.ring();
    const lastRing: TvDoorbellRing = {
      at: DateTime.formatIso(yield* DateTime.now),
      reason,
      threadTitle: card.threadTitle,
    };
    yield* updateStatus({ lastRing });
  });

  const observeThread = Effect.fn("TvDoorbell.observeThread")(function* (threadId: ThreadId) {
    if (!handle) return;
    const thread = yield* query.getThreadShell(threadId);
    if (!thread || thread.archivedAt !== null) {
      memory.delete(threadId);
      return;
    }
    const project = yield* projectService.getById(thread.projectId);
    if (Option.isNone(project)) return;
    const state = projectThreadAwarenessV2({
      environmentId: yield* environment.getEnvironmentId,
      project: project.value,
      thread,
    });
    const next: ThreadMemory = {
      phase: state?.phase ?? null,
      requestId: thread.pendingRuntimeRequest?.id ?? null,
    };
    const reason = ringReasonForTransition(memory.get(threadId), next, settings);
    memory.set(threadId, next);
    if (!reason || !state) return;
    const since = thread.latestUserMessageAt ?? thread.updatedAt;
    yield* Queue.offer(rings, {
      reason,
      card: {
        status:
          reason !== "needs-you"
            ? reason
            : state.phase === "waiting_for_approval"
              ? "pending-approval"
              : "awaiting-input",
        threadTitle: state.threadTitle,
        projectTitle: state.projectTitle,
        branch: thread.branch ?? (thread.worktreePath ? path.basename(thread.worktreePath) : null),
        age: compactAge(Duration.toMillis(DateTime.distance(since, yield* DateTime.now))),
      },
    });
  });

  const testRing = lifecycle
    .withPermit(
      Effect.gen(function* () {
        if (!handle)
          return yield* new TvDoorbellError({ message: "Turn on the TV doorbell first." });
        yield* cardLock
          .withPermit(
            ringNow({
              reason: "test",
              card: {
                status: "test",
                threadTitle: "Doorbell test",
                projectTitle: ACCESSORY_NAME,
                branch: null,
                age: "now",
              },
            }),
          )
          .pipe(
            Effect.mapError(
              () => new TvDoorbellError({ message: "Could not render the test card." }),
            ),
          );
        return yield* SubscriptionRef.get(status);
      }),
    )
    .pipe(Effect.withSpan("TvDoorbell.testRing"));

  const resetPairing = lifecycle
    .withPermit(
      Effect.gen(function* () {
        const wasRunning = handle !== null;
        const current = handle;
        handle = null;
        if (current) yield* Effect.promise(() => current.stop().catch(() => undefined));
        yield* SubscriptionRef.set(status, OFF_STATUS);
        const old = yield* loadIdentity.pipe(Effect.option);
        // The pairing must be gone before the identity is replaced, or a restart restores it.
        if (Option.isSome(old)) {
          const forgotten = old.value;
          yield* attempt("forget HomeKit pairing", async () =>
            (await loadHomekit()).forgetDoorbellPairing(storageDir, forgotten, platform),
          );
        }
        identity = null;
        yield* secrets.remove(IDENTITY_KEY);
        if (wasRunning || settings.tvDoorbellEnabled) yield* startDoorbell;
        return yield* SubscriptionRef.get(status);
      }),
    )
    .pipe(
      Effect.mapError(
        () => new TvDoorbellError({ message: "Could not reset the HomeKit pairing." }),
      ),
      Effect.withSpan("TvDoorbell.resetPairing"),
    );

  // Nothing here runs before server activation, so the doorbell never delays T3 Code's startup.
  const start = Effect.fn("TvDoorbell.start")(function* () {
    yield* Effect.addFinalizer(() => lifecycle.withPermit(stopDoorbell));
    yield* forkParked(reconcile);
    yield* forkParked(
      settingsService.streamChanges.pipe(
        Stream.runForEach((next) =>
          Effect.suspend(() => {
            settings = next;
            return reconcile;
          }),
        ),
      ),
    );
    yield* forkParked(
      Effect.forever(
        Queue.take(rings).pipe(
          Effect.flatMap((ring) =>
            cardLock
              .withPermit(ringNow(ring))
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("TV doorbell could not ring.").pipe(
                    Effect.annotateLogs({ error: error.message }),
                  ),
                ),
              ),
          ),
          Effect.andThen(Effect.sleep(RING_SPACING)),
        ),
      ),
    );
    yield* forkParked(
      Effect.gen(function* () {
        const queued = new Set<ThreadId>();
        const worker = yield* makeDrainableWorker((threadId: ThreadId) => {
          queued.delete(threadId);
          return observeThread(threadId).pipe(
            Effect.catch(() => Effect.logWarning("TV doorbell could not read a thread change.")),
          );
        });
        yield* query.streamDomainEvents.pipe(
          Stream.runForEach((event) => {
            // Off costs one branch per event; nothing is read or queued.
            if (!handle) return Effect.void;
            const threadId = eventThreadId(event);
            if (!threadId || !shouldPublishAgentAwarenessEvent(event) || queued.has(threadId))
              return Effect.void;
            queued.add(threadId);
            return worker.enqueue(threadId);
          }),
        );
      }),
    );
  });

  return TvDoorbell.of({
    changes: SubscriptionRef.changes(status),
    testRing,
    resetPairing,
    start,
  });
});

export const layer = Layer.effect(TvDoorbell, make);
