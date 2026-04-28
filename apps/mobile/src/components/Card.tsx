import { type ReactNode } from "react";
import { View, Text, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme/index";

interface CardProps {
  children: ReactNode;
  title?: string;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, title, footer, style }: CardProps) {
  const { palette, radius, spacing, typography } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={[
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: spacing.l,
          gap: spacing.m,
        },
        style,
      ]}
    >
      {title ? (
        <Text style={{ ...typography.title, color: palette.onSurface }}>
          {title}
        </Text>
      ) : null}
      {children}
      {footer ? <View style={{ marginTop: spacing.s }}>{footer}</View> : null}
    </View>
  );
}
