import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "../theme/index";
import { minTouchTarget } from "../theme/tokens";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends Omit<PressableProps, "style" | "onPress"> {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  fullWidth,
  style,
  testID,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const { palette, radius, spacing, typography } = useTheme();

  const bg =
    variant === "primary"
      ? palette.accent
      : variant === "danger"
        ? palette.danger
        : variant === "ghost"
          ? "transparent"
          : palette.surface;
  const fg =
    variant === "primary"
      ? palette.accentOn
      : variant === "danger"
        ? palette.dangerOn
        : palette.onSurface;
  const borderColor = variant === "secondary" || variant === "ghost" ? palette.border : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      accessibilityLabel={label}
      {...(accessibilityHint !== undefined ? { accessibilityHint } : {})}
      onPress={loading || disabled ? undefined : onPress}
      disabled={disabled || loading}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: minTouchTarget,
          minWidth: minTouchTarget,
          paddingHorizontal: spacing.l,
          paddingVertical: spacing.m,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === "secondary" || variant === "ghost" ? 1 : 0,
          opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.s,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : iconLeft}
      <Text
        style={{
          ...typography.label,
          color: fg,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      {iconRight}
    </Pressable>
  );
}
