import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEFAULT_LOCALE, MESSAGES, SUPPORTED_LOCALES, type Messages, type SupportedLocale } from "./messages";

interface I18nContextValue {
  locale: SupportedLocale;
  t: Messages;
  setLocale: (l: SupportedLocale) => Promise<void>;
}

const STORAGE_KEY = "vsbs.locale";

const I18nContext = createContext<I18nContextValue | null>(null);

function pickInitialLocale(): SupportedLocale {
  const detected = Localization.getLocales()[0]?.languageCode ?? DEFAULT_LOCALE;
  const found = SUPPORTED_LOCALES.find((l) => l === detected);
  return found ?? DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => pickInitialLocale());

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        const found = SUPPORTED_LOCALES.find((l) => l === stored);
        if (found) setLocaleState(found);
      })
      .catch(() => {
        // No stored locale; fall back to system.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = async (l: SupportedLocale) => {
    setLocaleState(l);
    await AsyncStorage.setItem(STORAGE_KEY, l);
  };

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: MESSAGES[locale], setLocale }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
