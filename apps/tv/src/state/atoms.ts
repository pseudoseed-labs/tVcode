import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionOnboarding,
  connectionStatusText,
  presentConnectionState,
} from "@t3tools/client-runtime/connection";
import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import { createEnvironmentShellAtoms } from "@t3tools/client-runtime/state/shell";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadStateAtoms,
  createThreadEnvironmentAtoms,
  createThreadFamilyAtoms,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { type Board, buildBoard, EMPTY_BOARD } from "../board/boardModel";
import { connectionAtomRuntime } from "../connection/runtime";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);

const threadFamilies = createThreadFamilyAtoms(connectionAtomRuntime, environmentShell.stateAtom);
export const threadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  threadFamilies.snapshotAtom,
);
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "tv:connection:connect-pairing-url",
  scheduler: createAtomCommandScheduler(),
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly pairingUrl: string }) => input.pairingUrl,
  },
  execute: (input: { readonly pairingUrl: string }) =>
    ConnectionOnboarding.ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing(input)),
    ),
});

export const enabledEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  return [...catalog.entries.values()]
    .filter((entry) => entry.enabled)
    .map((entry) => entry.target.environmentId);
});

export interface BoardState {
  readonly board: Board;
  /** True once every enabled environment has a live shell; transitions are only trusted then. */
  readonly live: boolean;
  readonly error: string | null;
  /** A connection that will not recover by retrying, such as a revoked session. */
  readonly blocked: boolean;
}

export const boardAtom = Atom.make((get): BoardState => {
  const shells: Array<{ environmentId: EnvironmentId; snapshot: OrchestrationV2ShellSnapshot }> =
    [];
  let live = true;
  let error: string | null = null;
  let blocked = false;
  const environmentIds = get(enabledEnvironmentIdsAtom);
  for (const environmentId of environmentIds) {
    const connection = presentConnectionState(
      Option.getOrElse(
        AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
        () => AVAILABLE_CONNECTION_STATE,
      ),
    );
    const stuck = connection.phase === "error" || connection.phase === "unsupported";
    blocked ||= stuck;
    if (stuck || connection.error !== null) error ??= connectionStatusText(connection);
    const state = get(environmentShell.stateValueAtom(environmentId));
    live &&= state.status === "live";
    error ??= Option.getOrNull(state.error);
    if (Option.isSome(state.snapshot))
      shells.push({ environmentId, snapshot: state.snapshot.value });
  }
  return {
    board: shells.length === 0 ? EMPTY_BOARD : buildBoard(shells),
    live: live && environmentIds.length > 0,
    error,
    blocked,
  };
});
