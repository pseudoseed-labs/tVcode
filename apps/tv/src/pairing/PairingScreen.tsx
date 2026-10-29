import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { buildPairingUrl } from "@t3tools/shared/remote";
import { useContext, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { FocusButton } from "../components/FocusButton";
import { connectPairingUrl } from "../state/atoms";
import { colors, space, type } from "../theme";

export function pairingUrlFromLink(url: string): string | null {
  try {
    return new URL(url).searchParams.get("pairingUrl")?.trim() || null;
  } catch {
    return null;
  }
}

function failureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if ("detail" in error && typeof error.detail === "string") return error.detail;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "Could not connect.";
}

export interface Pairing {
  readonly busy: boolean;
  readonly error: string | null;
  /** Resolves true once the server accepted the pairing. */
  readonly connect: (pairingUrl: string | null) => Promise<boolean>;
}

export function usePairing(): Pairing {
  const registry = useContext(RegistryContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (pairingUrl: string | null) => {
    if (!pairingUrl) {
      setError("Enter the server address.");
      return false;
    }
    setBusy(true);
    setError(null);
    const result = await runAtomCommand(registry, connectPairingUrl, { pairingUrl });
    setBusy(false);
    if (result._tag === "Failure") setError(failureMessage(squashAtomCommandFailure(result)));
    return result._tag === "Success";
  };

  return { busy, error, connect };
}

export function PairingForm(props: {
  readonly pairing: Pairing;
  readonly preferredFocus: boolean;
}) {
  const { pairing } = props;
  const [host, setHost] = useState("");
  const [code, setCode] = useState("");
  return (
    <View style={styles.form}>
      <Text style={styles.label}>Server address</Text>
      <TextInput
        value={host}
        onChangeText={setHost}
        placeholder="192.168.1.20:3773"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
        hasTVPreferredFocus={props.preferredFocus}
      />
      <Text style={styles.label}>Pairing code</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Code"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <FocusButton
        label={pairing.busy ? "Connecting…" : "Connect"}
        tone="primary"
        disabled={pairing.busy}
        onPress={() => void pairing.connect(buildPairingUrl(host, code))}
        style={styles.button}
      />
      {pairing.error !== null && <Text style={styles.error}>{pairing.error}</Text>}
    </View>
  );
}

export const PAIRING_HINT =
  "Create a pairing link in T3 Code's Connections settings, then enter the server address and pairing code. A whole pairing link also works in the address field.";

export function PairingScreen({ pairing }: { readonly pairing: Pairing }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Connect to T3 Code</Text>
      <Text style={styles.hint}>{PAIRING_HINT}</Text>
      <PairingForm pairing={pairing} preferredFocus />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: space.safeX * 3,
    paddingVertical: space.safeY * 2,
    justifyContent: "center",
  },
  title: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  hint: {
    color: colors.mutedForeground,
    fontSize: type.body,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  form: { gap: space.sm },
  label: { color: colors.mutedForeground, fontSize: type.callout, marginTop: space.sm },
  input: {
    color: colors.foreground,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 2,
    borderRadius: 14,
    fontSize: type.body,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  button: { marginTop: space.lg, alignSelf: "flex-start" },
  error: { color: colors.error, fontSize: type.body, marginTop: space.md },
});
