// Root Expo Router layout. Wraps the entire app in:
//   - SafeAreaProvider     (notch / nav-bar inset support)
//   - GestureHandlerRoot   (required by react-native-reanimated v3)
//   - ThemeProvider        (OKLCH palette + light/dark/high-contrast)
//   - I18nProvider         (en + hi messages)
//   - AuthProvider         (session token in expo-secure-store)
//   - StatusBar            (auto theme)
//
// We render Toast at the root so any deeply-nested screen can fire one
// without a per-screen container.

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";

import { ThemeProvider } from "@/theme/index";
import { I18nProvider } from "@/i18n/index";
import { AuthProvider } from "@/providers/auth";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <StatusBar style="auto" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Toast />
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
