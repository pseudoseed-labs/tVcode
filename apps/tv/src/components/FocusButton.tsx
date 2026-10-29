import { useState } from "react";
import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { colors, space, type } from "../theme";

export function FocusButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly detail?: string;
  readonly checked?: boolean;
  readonly tone?: "primary" | "danger" | "neutral";
  readonly disabled?: boolean;
  readonly preferredFocus?: boolean;
  readonly style?: ViewStyle;
}) {
  const [focused, setFocused] = useState(false);
  const tone = props.tone ?? "neutral";
  const fill =
    tone === "primary" ? colors.primary : tone === "danger" ? colors.error : colors.cardFocused;
  const label =
    props.checked === undefined ? props.label : `${props.checked ? "✓" : "○"}  ${props.label}`;
  return (
    <Pressable
      disabled={props.disabled}
      hasTVPreferredFocus={props.preferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={props.onPress}
      style={[
        styles.button,
        props.detail !== undefined && styles.withDetail,
        { backgroundColor: fill, opacity: props.disabled ? 0.4 : focused ? 1 : 0.72 },
        props.checked && styles.checked,
        focused && styles.focused,
        props.style,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      {props.detail !== undefined && (
        <Text style={styles.detail} numberOfLines={2}>
          {props.detail}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: "transparent",
    alignItems: "center",
  },
  withDetail: { alignItems: "flex-start", paddingHorizontal: space.md },
  checked: { borderColor: colors.primary },
  focused: { borderColor: colors.foreground, transform: [{ scale: 1.06 }] },
  label: { color: colors.primaryForeground, fontSize: type.body, fontWeight: "600" },
  detail: { color: colors.mutedForeground, fontSize: type.caption, marginTop: 4 },
});
