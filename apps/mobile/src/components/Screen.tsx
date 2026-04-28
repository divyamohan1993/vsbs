import { type ReactNode } from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme/index";

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = true, style }: ScreenProps) {
  const { palette, spacing } = useTheme();
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <Container
        contentContainerStyle={
          scroll
            ? {
                padding: spacing.l,
                gap: spacing.l,
                flexGrow: 1,
              }
            : undefined
        }
        style={[
          scroll ? null : { flex: 1, padding: spacing.l, gap: spacing.l },
          style,
        ]}
      >
        {children}
      </Container>
    </SafeAreaView>
  );
}
