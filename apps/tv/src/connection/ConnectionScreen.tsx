import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionCatalogEntry,
  connectionCatalogDisplayUrl,
  connectionStatusText,
  presentConnectionState,
} from "@t3tools/client-runtime/connection";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useContext, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { FocusButton } from "../components/FocusButton";
import { PAIRING_HINT, type Pairing, PairingForm } from "../pairing/PairingScreen";
import { environmentCatalog } from "../state/atoms";
import { colors, space, type } from "../theme";

function ConnectionRow(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ConnectionCatalogEntry;
  readonly preferredFocus: boolean;
}) {
  const registry = useContext(RegistryContext);
  const result = useAtomValue(environmentCatalog.stateAtom(props.environmentId));
  const connection = presentConnectionState(
    Option.getOrElse(AsyncResult.value(result), () => AVAILABLE_CONNECTION_STATE),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = connectionCatalogDisplayUrl(props.entry);
  const statusColor =
    connection.phase === "connected"
      ? colors.success
      : connection.phase === "connecting" || connection.phase === "available"
        ? colors.mutedForeground
        : colors.error;

  const run = async (
    command: typeof environmentCatalog.retryNow | typeof environmentCatalog.remove,
  ) => {
    setBusy(true);
    setError(null);
    const outcome = await runAtomCommand(registry, command, props.environmentId);
    setBusy(false);
    if (outcome._tag === "Failure") setError("That did not work. Try again.");
  };

  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {props.entry.target.label}
      </Text>
      {address !== null && (
        <Text style={styles.muted} numberOfLines={1}>
          {address}
        </Text>
      )}
      <Text style={[styles.status, { color: statusColor }]} numberOfLines={3}>
        {connectionStatusText(connection)}
      </Text>
      <View style={styles.actions}>
        <FocusButton
          label="Retry"
          preferredFocus={props.preferredFocus}
          disabled={busy}
          onPress={() => void run(environmentCatalog.retryNow)}
        />
        <FocusButton
          label="Forget"
          tone="danger"
          disabled={busy}
          onPress={() => void run(environmentCatalog.remove)}
        />
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/** Where a revoked session or a moved server is fixed: see status, forget, or pair again. */
export function ConnectionScreen({ pairing }: { readonly pairing: Pairing }) {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Connection</Text>
      {[...catalog.entries].map(([environmentId, entry], index) => (
        <ConnectionRow
          key={environmentId}
          environmentId={environmentId}
          entry={entry}
          preferredFocus={index === 0 && !pairing.busy}
        />
      ))}
      <Text style={styles.heading}>Pair again</Text>
      <Text style={styles.muted}>{PAIRING_HINT}</Text>
      <PairingForm pairing={pairing} preferredFocus={pairing.busy} />
      <Text style={styles.hint}>Press Menu to go back</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: space.safeX * 2,
    paddingVertical: space.safeY,
    gap: space.md,
  },
  title: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  heading: {
    color: colors.foreground,
    fontSize: type.headline,
    fontWeight: "600",
    marginTop: space.lg,
  },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 2,
    borderRadius: 20,
    padding: space.md,
    gap: space.xs,
  },
  rowTitle: { color: colors.foreground, fontSize: type.headline, fontWeight: "600" },
  status: { fontSize: type.callout },
  actions: { flexDirection: "row", gap: space.md, marginTop: space.sm },
  muted: { color: colors.mutedForeground, fontSize: type.callout },
  error: { color: colors.error, fontSize: type.callout },
  hint: { color: colors.mutedForeground, fontSize: type.caption, marginTop: space.lg },
});
