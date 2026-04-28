// =============================================================================
// Auth context. Owns the session token + subject pair stored in
// expo-secure-store, exposes a `signIn(token, subject)` and `signOut()`
// to the rest of the app, and re-hydrates on cold start.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiClient } from "../lib/api";

export interface Session {
  subject: string;
}

interface AuthContextValue {
  ready: boolean;
  session: Session | null;
  signIn: (opts: { token: string; subject: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const subject = await apiClient.getSubject();
        if (!cancelled) {
          setSession(subject ? { subject } : null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async ({ token, subject }: { token: string; subject: string }) => {
    await apiClient.setToken(token, subject);
    setSession({ subject });
  }, []);

  const signOut = useCallback(async () => {
    await apiClient.clearToken();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, session, signIn, signOut }),
    [ready, session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
