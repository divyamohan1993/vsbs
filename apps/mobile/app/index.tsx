// Entry redirect. Sends signed-in users into the tab navigator and
// signed-out users into the auth flow.

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/providers/auth";
import { useTheme } from "@/theme/index";

export default function IndexRedirect() {
  const { ready, session } = useAuth();
  const { palette } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}
