"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ToastProvider, useToast } from "../../../components/ui";
import { GlassPanel, SpecLabel } from "../../../components/luxe";

export function ArticleFeedback(): React.JSX.Element {
  return (
    <ToastProvider>
      <ArticleFeedbackInner />
    </ToastProvider>
  );
}

function ArticleFeedbackInner(): React.JSX.Element {
  const t = useTranslations();
  const toast = useToast();
  const [done, setDone] = useState<"yes" | "no" | null>(null);

  const respond = (kind: "yes" | "no") => {
    setDone(kind);
    toast.push({
      title: kind === "yes" ? t("help.feedback.thanks") : t("help.feedback.sorry"),
      description: kind === "yes" ? t("help.feedback.thanksBody") : t("help.feedback.sorryBody"),
      tone: kind === "yes" ? "success" : "info",
    });
  };

  return (
    <GlassPanel variant="muted" className="mt-12 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <SpecLabel>{t("help.feedback.label")}</SpecLabel>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => respond("yes")}
          disabled={done !== null}
          aria-pressed={done === "yes"}
        >
          {t("help.feedback.yes")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => respond("no")}
          disabled={done !== null}
          aria-pressed={done === "no"}
        >
          {t("help.feedback.no")}
        </Button>
      </div>
    </GlassPanel>
  );
}
