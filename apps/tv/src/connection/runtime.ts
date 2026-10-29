import { Connection } from "@t3tools/client-runtime/connection";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import { BoundedThreadSnapshotLoader } from "@t3tools/client-runtime/state/threads";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/reactivity";

import * as ConnectionPlatform from "./platform";

export const appAtomRegistry = AtomRegistry.make();

const layerConnection = Layer.mergeAll(
  BoundedThreadSnapshotLoader.layer,
  ShellSnapshotLoader.layer,
).pipe(Layer.provideMerge(Connection.layer), Layer.provideMerge(ConnectionPlatform.layer));

export const connectionAtomRuntime = Atom.runtime(layerConnection);
