import { useId } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "../theme/index";

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | undefined;
  hint?: string;
}

export function TextField({ label, error, hint, ...rest }: TextFieldProps) {
  const { palette, spacing, radius, typography } = useTheme();
  const generatedId = useId();
  const inputId = (rest.nativeID ?? `tf-${generatedId}`).replace(/:/g, "-");
  return (
    <View style={{ gap: spacing.xs }}>
      <Text nativeID={`${inputId}-label`} style={{ ...typography.label, color: palette.onSurface }}>
        {label}
      </Text>
      <TextInput
        nativeID={inputId}
        accessibilityLabel={label}
        accessibilityHint={hint ?? ""}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={palette.muted}
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.border,
          backgroundColor: palette.surfaceMuted,
          color: palette.onSurface,
          borderRadius: radius.md,
          paddingHorizontal: spacing.m,
          paddingVertical: spacing.s,
          fontSize: 16,
        }}
        {...rest}
      />
      {error ? (
        <Text style={{ ...typography.caption, color: palette.danger }}>{error}</Text>
      ) : hint ? (
        <Text style={{ ...typography.caption, color: palette.muted }}>{hint}</Text>
      ) : null}
    </View>
  );
}
