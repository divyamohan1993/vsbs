"use client";

import { useEffect } from "react";
import { bootBrowserTelemetry, initBrowserOtel, recordRouteChange } from "./telemetry";

interface TelemetryBootProps {
  region: string;
  version: string;
  exporterUrl?: string;
}

export function TelemetryBoot({ region, version, exporterUrl }: TelemetryBootProps): null {
  useEffect(() => {
    const dispose = bootBrowserTelemetry();
    if (exporterUrl) {
      void initBrowserOtel({
        serviceName: "vsbs-web",
        region,
        version,
        exporterUrl,
      });
    }
    const onPop = () => recordRouteChange(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      dispose();
    };
  }, [region, version, exporterUrl]);
  return null;
}
