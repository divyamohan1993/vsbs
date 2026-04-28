"use client";

// Client-side bootstrap. Mounts once at the root layout and:
//   - registers the service worker (idempotent),
//   - installs the Web Vitals reporter,
//   - flushes any offline write queue when the browser comes back online.
//
// The component renders nothing visible — a screen-reader-only status
// region echoes the online/offline transition so AT users hear it.

import { useEffect, useState } from "react";
import { flushQueue, registerServiceWorker, useOnline } from "../lib/offline";
import { installVitalsReporter } from "../lib/lighthouse";

export function AppBoot(): React.JSX.Element | null {
  const online = useOnline();
  const [announce, setAnnounce] = useState<string>("");

  useEffect(() => {
    void registerServiceWorker().catch(() => {
      /* service worker registration is best-effort */
    });
    installVitalsReporter({ echo: process.env.NODE_ENV === "development" });
  }, []);

  useEffect(() => {
    if (online) {
      setAnnounce("Back online. Syncing pending changes.");
      void flushQueue().catch(() => {
        /* silent retry on next online event */
      });
    } else {
      setAnnounce("You are offline. Changes will queue and sync later.");
    }
  }, [online]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announce}
    </div>
  );
}
