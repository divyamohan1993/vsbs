"use client";

// Consent dashboard — Apple-Privacy-Dashboard-tier surface.
//
// Hero: serif headline "Your consents.", a granted/total KPI on the right.
// Each row: small caps purpose name, plain-English serif description,
// mono legal-basis caption, a bespoke pill toggle that flips with a
// 240ms ease. Toggling a required purpose off opens a Dialog that
// explains the consequence. "View notice" opens a Dialog with the full
// notice text.
//
// Footer: Export (toast), Delete (DELETE-typed copper-bordered confirm).

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  ToastProvider,
  useToast,
} from "../../../components/ui";
import {
  GlassPanel,
  GoldSeal,
  KPIBlock,
  SpecLabel,
} from "../../../components/luxe";
import { cn } from "../../../components/ui/cn";

type Purpose =
  | "service-fulfilment"
  | "diagnostic-telemetry"
  | "voice-photo-processing"
  | "marketing"
  | "ml-improvement-anonymised"
  | "autonomy-delegation"
  | "autopay-within-cap";

const REQUIRED: Set<Purpose> = new Set(["service-fulfilment"]);

interface EffectiveItem {
  purpose: Purpose;
  granted: boolean;
  version: string;
  at: string;
  staleAgainst?: string;
}

interface ConsentSnapshot {
  ownerId: string;
  latestVersions: Record<Purpose, string>;
  items: EffectiveItem[];
  needsReConsent: Purpose[];
}

export function ConsentDashboard({
  purposes,
}: {
  purposes: Purpose[];
}): React.JSX.Element {
  return (
    <ToastProvider>
      <ConsentDashboardInner purposes={purposes} />
    </ToastProvider>
  );
}

// Back-compat for any caller still importing the legacy name.
export const ConsentToggles = ConsentDashboard;

function ConsentDashboardInner({ purposes }: { purposes: Purpose[] }): React.JSX.Element {
  const t = useTranslations();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Purpose | null>(null);

  // Dialogs.
  const [noticeFor, setNoticeFor] = useState<Purpose | null>(null);
  const [consequenceFor, setConsequenceFor] = useState<Purpose | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch("/api/proxy/me/consent", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = (await res.json()) as { data: ConsentSnapshot };
      setSnapshot(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grant = useCallback(
    (purpose: Purpose): void => {
      if (!snapshot) return;
      setBusy(purpose);
      startTransition(async () => {
        try {
          const res = await fetch("/api/proxy/me/consent/grant", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              purpose,
              version: snapshot.latestVersions[purpose],
              source: "web",
            }),
          });
          if (!res.ok) throw new Error(`Grant failed (${res.status})`);
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(null);
        }
      });
    },
    [refresh, snapshot],
  );

  const revoke = useCallback(
    (purpose: Purpose): void => {
      setBusy(purpose);
      startTransition(async () => {
        try {
          const res = await fetch("/api/proxy/me/consent/revoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ purpose }),
          });
          if (!res.ok && res.status !== 409) throw new Error(`Revoke failed (${res.status})`);
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(null);
        }
      });
    },
    [refresh],
  );

  const items: EffectiveItem[] = useMemo(
    () =>
      purposes.map((p) => {
        const found = snapshot?.items.find((it) => it.purpose === p);
        if (found) return found;
        return {
          purpose: p,
          granted: REQUIRED.has(p),
          version: snapshot?.latestVersions[p] ?? "1.0.0",
          at: "",
        };
      }),
    [purposes, snapshot],
  );

  const grantedCount = items.filter((it) => it.granted && !it.staleAgainst).length;
  const totalCount = items.length;

  const onToggle = useCallback(
    (item: EffectiveItem) => {
      if (item.granted) {
        if (REQUIRED.has(item.purpose)) {
          setConsequenceFor(item.purpose);
          return;
        }
        revoke(item.purpose);
        return;
      }
      grant(item.purpose);
    },
    [grant, revoke],
  );

  const onConfirmConsequence = useCallback(() => {
    if (consequenceFor) {
      revoke(consequenceFor);
      setConsequenceFor(null);
    }
  }, [consequenceFor, revoke]);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/proxy/me/data-export", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      toast.push({
        title: t("consent.exportToastTitle"),
        description: t("consent.exportToastBody"),
        tone: "success",
      });
    } catch {
      toast.push({ title: t("consent.exportFailed"), tone: "danger" });
    } finally {
      setExporting(false);
    }
  }, [t, toast]);

  const onDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/proxy/me/erasure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      if (!res.ok && res.status !== 202) throw new Error(`Erasure failed (${res.status})`);
      toast.push({
        title: t("consent.deleteToastTitle"),
        description: t("consent.deleteToastBody"),
        tone: "warning",
      });
      setDeleteOpen(false);
      setDeleteConfirm("");
    } catch {
      toast.push({ title: t("consent.deleteFailed"), tone: "danger" });
    } finally {
      setDeleting(false);
    }
  }, [t, toast]);

  return (
    <div className="space-y-10" aria-busy={pending || undefined}>
      {/* ---- Hero --------------------------------------------------- */}
      <header className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:gap-12">
        <div className="flex flex-col gap-4">
          <SpecLabel>{t("consent.eyebrow")}</SpecLabel>
          <h2 className="font-[family-name:var(--font-display)] text-[clamp(2.25rem,5vw,3.25rem)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
            {t("consent.title")}
          </h2>
          <p className="max-w-[52ch] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
            {t("consent.subtitle")}
          </p>
        </div>
        <GlassPanel variant="elevated" className="flex flex-col justify-center">
          <KPIBlock
            label={t("consent.kpiLabel")}
            value={t("consent.kpiValue", { count: grantedCount, total: totalCount })}
            unit={t("consent.kpiUnit")}
            status={grantedCount >= totalCount - 2 ? "ok" : "watch"}
            description={t("consent.kpiDescription")}
            size="md"
          />
        </GlassPanel>
      </header>

      {error ? (
        <GlassPanel
          role="alert"
          className="border-[var(--color-crimson)] !p-5"
          style={{ borderColor: "var(--color-crimson)" }}
        >
          <p className="text-pearl">{error}</p>
        </GlassPanel>
      ) : null}

      {snapshot && snapshot.needsReConsent.length > 0 ? (
        <GlassPanel
          role="status"
          className="!p-5"
          style={{ borderColor: "var(--color-amber)" }}
        >
          <p className="text-pearl">
            {t("consent.staleBanner", { count: snapshot.needsReConsent.length })}
          </p>
        </GlassPanel>
      ) : null}

      {/* ---- Rows --------------------------------------------------- */}
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.purpose}>
            <ConsentRow
              item={item}
              required={REQUIRED.has(item.purpose)}
              busy={busy === item.purpose}
              labels={{
                purposeName: t(`consent.purposes.${item.purpose}.name`),
                purposeBody: t(`consent.purposes.${item.purpose}.body`),
                legalBasis: t(`consent.legalBasis.${item.purpose}`),
                versionDetail: item.staleAgainst
                  ? t("consent.staleDetail", {
                      from: item.version,
                      to: snapshot?.latestVersions[item.purpose] ?? item.version,
                    })
                  : t("consent.versionDetail", { version: item.version }),
                viewNotice: t("consent.viewNotice"),
                ariaLabel: t("consent.ariaLabel"),
                granted: t("consent.granted"),
                notGranted: t("consent.notGranted"),
              }}
              onToggle={() => onToggle(item)}
              onViewNotice={() => setNoticeFor(item.purpose)}
            />
          </li>
        ))}
      </ul>

      {/* ---- Footer ------------------------------------------------- */}
      <GlassPanel variant="muted" className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <GoldSeal size={24} label="DPDP" />
          <div className="flex flex-col gap-1">
            <SpecLabel>DPDP</SpecLabel>
            <p className="text-[var(--text-body)] leading-[1.5] text-pearl">
              {t("consent.footerTitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={onExport} loading={exporting}>
            {t("consent.exportCta")}
          </Button>
          <Button variant="outline" onClick={() => setDeleteOpen(true)}>
            {t("consent.deleteCta")}
          </Button>
        </div>
      </GlassPanel>

      {/* ---- Notice dialog ----------------------------------------- */}
      <Dialog open={noticeFor !== null} onOpenChange={(o) => !o && setNoticeFor(null)}>
        <DialogContent>
          <DialogTitle>{t("consent.noticeTitle")}</DialogTitle>
          {noticeFor ? (
            <>
              <p className="mt-2 text-[var(--text-control)] tracking-[var(--tracking-wide)] uppercase text-pearl-soft">
                {t(`consent.purposes.${noticeFor}.en`)}
              </p>
              <DialogDescription>
                {t(`consent.noticeBody.${noticeFor}`)}
              </DialogDescription>
              <p className="luxe-mono mt-4 text-[var(--text-caption)] uppercase text-pearl-soft">
                {t(`consent.legalBasis.${noticeFor}`)}
              </p>
            </>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoticeFor(null)}>
              {t("consent.noticeClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Required-purpose consequence dialog ------------------- */}
      <Dialog
        open={consequenceFor !== null}
        onOpenChange={(o) => !o && setConsequenceFor(null)}
      >
        <DialogContent>
          <DialogTitle>{t("consent.consequenceTitle")}</DialogTitle>
          <DialogDescription>{t("consent.consequenceBody")}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConsequenceFor(null)}>
              {t("consent.consequenceCancel")}
            </Button>
            <Button variant="danger" onClick={onConfirmConsequence}>
              {t("consent.consequenceConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- DELETE confirm ---------------------------------------- */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setDeleteConfirm("");
        }}
      >
        <DialogContent
          className="!border-2"
          style={{ borderColor: "var(--color-copper)" }}
        >
          <DialogTitle>{t("consent.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("consent.deleteBody")}</DialogDescription>
          <div className="mt-6 flex flex-col gap-2">
            <label
              htmlFor="consent-delete-confirm"
              className="luxe-spec-label"
            >
              {t("consent.deleteInputLabel")}
            </label>
            <Input
              id="consent-delete-confirm"
              type="text"
              autoComplete="off"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              aria-describedby="consent-delete-hint"
            />
            <p
              id="consent-delete-hint"
              className="text-[var(--text-caption)] text-pearl-soft"
            >
              {t("consent.deleteHint")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t("consent.deleteCancel")}
            </Button>
            <Button
              variant="danger"
              disabled={deleteConfirm !== "DELETE"}
              loading={deleting}
              onClick={onDelete}
            >
              {t("consent.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Single consent row -------------------------------------------------

function ConsentRow({
  item,
  required,
  busy,
  labels,
  onToggle,
  onViewNotice,
}: {
  item: EffectiveItem;
  required: boolean;
  busy: boolean;
  labels: {
    purposeName: string;
    purposeBody: string;
    legalBasis: string;
    versionDetail: string;
    viewNotice: string;
    ariaLabel: string;
    granted: string;
    notGranted: string;
  };
  onToggle: () => void;
  onViewNotice: () => void;
}): React.JSX.Element {
  const stale = item.staleAgainst !== undefined;
  const checked = item.granted && !stale;
  const switchId = useId();
  return (
    <GlassPanel className="!py-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex flex-col gap-3 md:max-w-[60ch]">
          <div className="flex flex-wrap items-center gap-3">
            <SpecLabel>{labels.purposeName}</SpecLabel>
            {required ? (
              <span
                className="luxe-mono inline-flex items-center rounded-full px-2 py-0.5 text-[var(--text-caption)] uppercase"
                style={{
                  borderColor: "var(--color-copper)",
                  border: "1px solid",
                  color: "var(--color-copper)",
                }}
              >
                required
              </span>
            ) : null}
          </div>
          <p
            className="font-[family-name:var(--font-display)] text-[var(--text-h4)] font-medium leading-[1.25] tracking-[var(--tracking-tight)] text-pearl"
            lang="hi"
          >
            {labels.purposeBody}
          </p>
          <p className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wide)] text-pearl-soft">
            {labels.legalBasis}
          </p>
          <p className="text-[var(--text-caption)] text-pearl-soft">{labels.versionDetail}</p>
          <button
            type="button"
            onClick={onViewNotice}
            className="luxe-spec-label !mt-1 inline-flex items-center gap-1 self-start text-pearl-muted hover:text-pearl"
          >
            <span>{labels.viewNotice}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <PillToggle
            id={switchId}
            checked={checked}
            disabled={busy}
            onChange={onToggle}
            ariaLabel={`${labels.ariaLabel}: ${labels.purposeName}`}
          />
          <span className="text-[var(--text-caption)] tracking-[var(--tracking-wide)] uppercase text-pearl-soft">
            {checked ? labels.granted : labels.notGranted}
          </span>
        </div>
      </div>
    </GlassPanel>
  );
}

// ---- Bespoke pill toggle ------------------------------------------------
//
// 56x28 pill, 24px circle, copper when on, hairline when off, 240ms ease,
// 2px copper focus ring. role="switch" with aria-checked.

function PillToggle({
  id,
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "luxe-pill-toggle relative inline-flex h-7 w-14 shrink-0 items-center rounded-full transition-[background-color,border-color,box-shadow]",
        "border duration-[var(--duration-state)] ease-[var(--ease-enter)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "luxe-pill-on" : "luxe-pill-off",
      )}
      style={{ minWidth: 56, minHeight: 28 }}
    >
      <span
        aria-hidden="true"
        className="luxe-pill-circle inline-block h-6 w-6 rounded-full transition-transform duration-[var(--duration-state)] ease-[var(--ease-enter)]"
        style={{
          transform: checked ? "translateX(28px)" : "translateX(2px)",
        }}
      />
      <style>{`
        .luxe-pill-toggle.luxe-pill-on {
          background: linear-gradient(135deg, var(--color-copper) 0%, var(--color-copper-deep) 100%);
          border-color: var(--color-copper);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 18px rgba(201,163,106,0.32);
        }
        .luxe-pill-toggle.luxe-pill-off {
          background: rgba(255,255,255,0.04);
          border-color: var(--color-hairline-strong);
        }
        .luxe-pill-toggle:hover.luxe-pill-off {
          border-color: var(--color-hairline-hover);
          background: rgba(255,255,255,0.06);
        }
        .luxe-pill-toggle .luxe-pill-circle {
          background: linear-gradient(180deg, #F2EEE6 0%, #C9C3B5 100%);
          box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.1);
        }
        .luxe-pill-toggle.luxe-pill-on .luxe-pill-circle {
          background: linear-gradient(180deg, #F8F1E0 0%, #E6D5B1 100%);
        }
      `}</style>
    </button>
  );
}
