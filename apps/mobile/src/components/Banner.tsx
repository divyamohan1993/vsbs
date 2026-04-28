import { Text, View } from "react-native";

import { useTheme } from "../theme/index";

interface BannerProps {
  text: string;
  variant?: "info" | "warn" | "danger" | "good";
}

export function Banner({ text, variant = "info" }: BannerProps) {
  const { palette, spacing, radius, typography } = useTheme();
  const bg =
    variant === "warn"
      ? palette.warn
      : variant === "danger"
        ? palette.danger
        : variant === "good"
          ? palette.good
          : palette.accent;
  const fg =
    variant === "warn"
      ? palette.warnOn
      : variant === "danger"
        ? palette.dangerOn
        : variant === "good"
          ? palette.goodOn
          : palette.accentOn;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: bg,
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.s,
        borderRadius: radius.sm,
      }}
    >
      <Text style={{ ...typography.label, color: fg, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}
