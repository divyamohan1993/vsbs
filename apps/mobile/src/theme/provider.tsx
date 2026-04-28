import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { paletteFor, spacing, radius, typography, type Palette, type ThemeMode } from "./tokens";

interface ThemeContextValue {
  mode: ThemeMode;
  palette: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  setMode: (m: ThemeMode) => Promise<void>;
}

const STORAGE_KEY = "vsbs.theme.mode";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(system === "light" ? "light" : "dark");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === "light" || stored === "dark" || stored === "high-contrast") {
          setModeState(stored);
        }
      })
      .catch(() => {
        // No stored preference; fall back to system.
      });
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (cancelled) return;
      AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
        if (stored) return;
        setModeState(colorScheme === "light" ? "light" : "dark");
      });
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const setMode = async (m: ThemeMode) => {
    setModeState(m);
    await AsyncStorage.setItem(STORAGE_KEY, m);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      palette: paletteFor(mode),
      spacing,
      radius,
      typography,
      setMode,
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
