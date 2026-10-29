import {
  ConnectionCatalogDocument,
  type ConnectionCatalogDocument as ConnectionCatalogDocumentType,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SecureStore from "expo-secure-store";

// tvOS only guarantees the keychain and NSUserDefaults across launches; the
// file system is a purgeable cache. The catalog holds the bearer credential.
const CONNECTION_CATALOG_KEY = "t3code.tv.connection-catalog.v1";

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the local connection catalog: ${String(cause)}`,
  });
}

export const make = Effect.fn("tv.connectionStorage.makeCatalogStore")(function* () {
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocumentType>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const load = Effect.gen(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) return cached.value;
    const raw = yield* Effect.tryPromise({
      try: () => SecureStore.getItemAsync(CONNECTION_CATALOG_KEY),
      catch: (cause) => catalogError("load", cause),
    });
    const catalog =
      raw === null || raw.trim() === ""
        ? EMPTY_CONNECTION_CATALOG_DOCUMENT
        : yield* decodeCatalog(raw).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Discarding corrupt TV connection catalog", cause).pipe(
                Effect.as(EMPTY_CONNECTION_CATALOG_DOCUMENT),
              ),
            ),
          );
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(load);

  const update = (
    transform: (catalog: ConnectionCatalogDocumentType) => ConnectionCatalogDocumentType,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = transform(yield* load);
        const encoded = yield* encodeCatalog(next).pipe(
          Effect.mapError((cause) => catalogError("encode", cause)),
        );
        yield* Effect.tryPromise({
          try: () => SecureStore.setItemAsync(CONNECTION_CATALOG_KEY, encoded),
          catch: (cause) => catalogError("save", cause),
        });
        yield* Ref.set(state, Option.some(next));
      }),
    );

  return { read, update };
});
