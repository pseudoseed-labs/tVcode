import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Linking, StyleSheet, Text, TVEventControl, View } from "react-native";

import { BoardScreen, type ThreadRef } from "./board/BoardScreen";
import { ConnectionScreen } from "./connection/ConnectionScreen";
import { appAtomRegistry } from "./connection/runtime";
import { TransitionOverlay } from "./overlay/TransitionOverlay";
import {
  type Pairing,
  PairingScreen,
  pairingUrlFromLink,
  usePairing,
} from "./pairing/PairingScreen";
import { environmentCatalog } from "./state/atoms";
import { colors } from "./theme";
import { ThreadScreen } from "./thread/ThreadScreen";

type Screen =
  | { readonly kind: "board" }
  | { readonly kind: "thread"; readonly thread: ThreadRef }
  | { readonly kind: "connection" };

const BOARD: Screen = { kind: "board" };

function Root() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const catalogResult = useAtomValue(environmentCatalog.catalogAtom);
  const [screen, setScreen] = useState<Screen>(BOARD);
  const base = usePairing();
  const pairing: Pairing = {
    ...base,
    connect: async (pairingUrl) => {
      const paired = await base.connect(pairingUrl);
      if (paired) setScreen(BOARD);
      return paired;
    },
  };

  const pairingRef = useRef(pairing);
  useEffect(() => {
    pairingRef.current = pairing;
  });

  // Same `pairingUrl` parameter as the mobile app's QR links. Listened for while paired too,
  // so a fresh link replaces a revoked session or a moved server.
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      const pairingUrl = url ? pairingUrlFromLink(url) : null;
      if (pairingUrl === null) return;
      setScreen({ kind: "connection" });
      void pairingRef.current.connect(pairingUrl);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", (event) => open(event.url));
    return () => subscription.remove();
  }, []);

  // Menu backs out to the board; on the board it falls through to tvOS and leaves the app.
  const away = screen.kind !== "board";
  useEffect(() => {
    if (!away) return;
    TVEventControl.enableTVMenuKey();
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setScreen(BOARD);
      return true;
    });
    return () => {
      subscription.remove();
      TVEventControl.disableTVMenuKey();
    };
  }, [away]);

  if (AsyncResult.isFailure(catalogResult)) {
    return (
      <View style={styles.root}>
        <Text style={styles.fatal}>{Cause.pretty(catalogResult.cause)}</Text>
      </View>
    );
  }
  if (!catalog.isReady) return <View style={styles.root} />;
  if (catalog.entries.size === 0) return <PairingScreen pairing={pairing} />;
  return (
    <View style={styles.root}>
      {screen.kind === "board" && (
        <BoardScreen
          onOpenThread={(thread) => setScreen({ kind: "thread", thread })}
          onOpenConnection={() => setScreen({ kind: "connection" })}
        />
      )}
      {screen.kind === "thread" && <ThreadScreen thread={screen.thread} />}
      {screen.kind === "connection" && <ConnectionScreen pairing={pairing} />}
      <TransitionOverlay />
    </View>
  );
}

export default function App() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <Root />
    </RegistryContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fatal: { color: colors.error, fontSize: 22, padding: 80 },
});
