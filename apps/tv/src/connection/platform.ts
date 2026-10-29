import {
  ClientCapabilities,
  PlatformConnectionSource,
  Persistence,
  putRemoteDpopTokenInCatalog,
  registerConnectionInCatalog,
  removeCatalogValue,
  removeConnectionFromCatalog,
  replaceCatalogValue,
  setConnectionEnabledInCatalog,
  setRoutesInCatalog,
} from "@t3tools/client-runtime/platform";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import {
  ConnectionBlockedError,
  type ConnectionTransientError,
  Connectivity,
  CredentialStore,
  ProfileStore,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { RelayMobileClientId } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import Constants from "expo-constants";
import * as ExpoCrypto from "expo-crypto";
import { AppState, Platform } from "react-native";

import * as CatalogStore from "./catalogStore";

const unsupported = (detail: string) =>
  new ConnectionBlockedError({ reason: "unsupported", detail });

function persistenceError(
  operation: Persistence.ConnectionPersistenceError["operation"],
  error: ConnectionTransientError,
) {
  return new Persistence.ConnectionPersistenceError({ operation, message: error.message });
}

const layerStorage = Layer.effectContext(
  Effect.gen(function* () {
    const catalog = yield* CatalogStore.make();
    const targetStore = Persistence.ConnectionTargetStore.of({
      list: catalog.read.pipe(
        Effect.map((document) => document.targets),
        Effect.mapError((error) => persistenceError("list-targets", error)),
      ),
      listDisabled: catalog.read.pipe(
        Effect.map((document) => document.disabledEnvironmentIds),
        Effect.mapError((error) => persistenceError("list-disabled-targets", error)),
      ),
    });
    const registrationStore = Persistence.ConnectionRegistrationStore.of({
      register: (registration, routes) =>
        catalog
          .update((document) => registerConnectionInCatalog(document, registration, routes))
          .pipe(Effect.mapError((error) => persistenceError("register-connection", error))),
      setRoutes: (environmentId, routes) =>
        catalog
          .update((document) => setRoutesInCatalog(document, environmentId, routes))
          .pipe(Effect.mapError((error) => persistenceError("set-connection-routes", error))),
      remove: (environmentId) =>
        catalog
          .update((document) => removeConnectionFromCatalog(document, environmentId))
          .pipe(Effect.mapError((error) => persistenceError("remove-connection", error))),
      setEnabled: (environmentId, enabled) =>
        catalog
          .update((document) => setConnectionEnabledInCatalog(document, environmentId, enabled))
          .pipe(Effect.mapError((error) => persistenceError("set-connection-enabled", error))),
    });
    const profileStore = ProfileStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.profiles.find((candidate) => candidate.connectionId === connectionId),
            ),
          ),
        ),
      put: (profile) =>
        catalog.update((document) => ({
          ...document,
          profiles: replaceCatalogValue(document.profiles, (value) => value.connectionId, profile),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          profiles: removeCatalogValue(
            document.profiles,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const credentialStore = CredentialStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.credentials.find((entry) => entry.connectionId === connectionId)?.credential,
            ),
          ),
        ),
      put: (connectionId, credential) =>
        catalog.update((document) => ({
          ...document,
          credentials: replaceCatalogValue(document.credentials, (value) => value.connectionId, {
            connectionId,
            credential,
          }),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          credentials: removeCatalogValue(
            document.credentials,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const remoteTokenStore = TokenStore.make({
      get: (environmentId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.remoteDpopTokens.find((token) => token.environmentId === environmentId),
            ),
          ),
        ),
      put: (token) => catalog.update((document) => putRemoteDpopTokenInCatalog(document, token)),
      remove: (environmentId) =>
        catalog.update((document) => ({
          ...document,
          remoteDpopTokens: removeCatalogValue(
            document.remoteDpopTokens,
            (value) => value.environmentId,
            environmentId,
          ),
        })),
    });
    return Context.make(Persistence.ConnectionTargetStore, targetStore).pipe(
      Context.add(Persistence.ConnectionRegistrationStore, registrationStore),
      Context.add(ProfileStore.ConnectionProfileStore, profileStore),
      Context.add(CredentialStore.ConnectionCredentialStore, credentialStore),
      Context.add(TokenStore.RemoteDpopAccessTokenStore, remoteTokenStore),
    );
  }),
);

// The board renders from the live socket; nothing is cached across launches.
const layerEnvironmentCache = Layer.succeed(
  Persistence.EnvironmentCacheStore,
  Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeedNone,
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  }),
);

// An Apple TV sits on wired or Wi-Fi LAN; the supervisor's own probes catch drops.
const layerConnectivity = Layer.succeed(
  Connectivity.Connectivity,
  Connectivity.Connectivity.of({ status: Effect.succeed("online"), changes: Stream.never }),
);

const layerWakeups = Layer.effect(
  Wakeups.ConnectionWakeups,
  Effect.gen(function* () {
    const wakeups = yield* PubSub.unbounded<"application-active">();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        AppState.addEventListener("change", (state) => {
          if (state === "active") PubSub.publishUnsafe(wakeups, "application-active");
        }),
      ),
      (subscription) => Effect.sync(() => subscription.remove()),
    );
    return Wakeups.ConnectionWakeups.of({ changes: Stream.fromPubSub(wakeups) });
  }),
);

const layerCapabilities = Layer.succeedContext(
  Context.make(
    ClientCapabilities.CloudSession,
    ClientCapabilities.CloudSession.of({
      identity: Effect.succeedNone,
      clerkToken: Effect.fail(unsupported("Cloud Connect is not available on Apple TV.")),
    }),
  ).pipe(
    Context.add(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeedNone }),
    ),
    Context.add(
      ClientCapabilities.RelayDeviceIdentity,
      ClientCapabilities.RelayDeviceIdentity.of({ deviceId: Effect.succeedNone }),
    ),
    Context.add(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: {
          label: "T3 Code TV",
          deviceType: "tv",
          ...(Platform.OS === "ios" ? { os: "tvOS" } : {}),
          surface: "tv",
          ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
        },
      }),
    ),
    Context.add(
      ClientCapabilities.SshEnvironmentGateway,
      ClientCapabilities.SshEnvironmentGateway.of({
        provision: () => Effect.fail(unsupported("SSH environments need the desktop app.")),
        prepare: () => Effect.fail(unsupported("SSH environments need the desktop app.")),
        disconnect: () => Effect.void,
      }),
    ),
    Context.add(
      PlatformConnectionSource.PlatformConnectionSource,
      PlatformConnectionSource.PlatformConnectionSource.of({ registrations: Stream.empty }),
    ),
    // Relay routes need a Cloud Connect session, which this client never has.
    Context.add(
      ManagedRelay.ManagedRelayDpopSigner,
      ManagedRelay.ManagedRelayDpopSigner.of({
        thumbprint: Effect.fail(
          new ManagedRelay.ManagedRelayDpopKeyLoadError({
            keyStore: "expo-secure-store",
            cause: "unsupported",
          }),
        ),
        createProof: (input) =>
          Effect.fail(
            new ManagedRelay.ManagedRelayDpopProofCreationError({
              method: input.method,
              url: input.url,
              cause: "unsupported",
            }),
          ),
      }),
    ),
  ),
);

const DIGEST_ALGORITHMS: Record<Crypto.DigestAlgorithm, ExpoCrypto.CryptoDigestAlgorithm> = {
  "SHA-1": ExpoCrypto.CryptoDigestAlgorithm.SHA1,
  "SHA-256": ExpoCrypto.CryptoDigestAlgorithm.SHA256,
  "SHA-384": ExpoCrypto.CryptoDigestAlgorithm.SHA384,
  "SHA-512": ExpoCrypto.CryptoDigestAlgorithm.SHA512,
};

const layerCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: ExpoCrypto.getRandomBytes,
    digest: (algorithm, data) =>
      Effect.promise(async () => {
        const input = new Uint8Array(data.length);
        input.set(data);
        return new Uint8Array(await ExpoCrypto.digest(DIGEST_ALGORITHMS[algorithm], input));
      }),
  }),
);

const layerHttpClient = layerRemoteHttpClient(fetch);

const layerRelayClient = ManagedRelay.layer({
  relayUrl: "http://relay.invalid",
  clientId: RelayMobileClientId,
}).pipe(Layer.provide(Layer.merge(layerHttpClient, layerCapabilities)));

export const layer = Layer.mergeAll(
  layerStorage,
  layerEnvironmentCache,
  layerConnectivity,
  layerWakeups,
  layerCapabilities,
  layerHttpClient,
  layerRelayClient,
  layerCrypto,
  Socket.layerWebSocketConstructorGlobal,
);
