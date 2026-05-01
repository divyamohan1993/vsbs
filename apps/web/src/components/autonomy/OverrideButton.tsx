"use client";

// OverrideButton — large copper-outlined CTA that opens a confirmation
// dialog. The interior glow ramps up on hover. Click cycles to a dialog
// showing the canonical-bytes preview and a crimson confirm.

import { useState } from "react";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../ui/Dialog";
import { GlassPanel } from "../luxe";
import { cn } from "../ui/cn";

interface Props {
  grantId: string | null;
  canonicalBytesPreview?: string;
  onRevoked: (grantId: string) => void;
  onError: (message: string) => void;
  className?: string;
}

export function OverrideButton({
  grantId,
  canonicalBytesPreview,
  onRevoked,
  onError,
  className,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    if (!grantId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/autonomy/grants/${encodeURIComponent(grantId)}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "owner-override-via-dashboard" }),
      });
      if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
      onRevoked(grantId);
      setOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={!grantId}
        aria-label="Override and revoke command grant"
        onClick={() => setOpen(true)}
        className={cn(
          "luxe-override-btn group inline-flex h-16 w-full items-center justify-center gap-3",
          "rounded-[var(--radius-md)] border px-6",
          "luxe-mono uppercase tracking-[var(--tracking-caps)] text-[length:var(--text-control)] text-pearl",
          "transition-[box-shadow,filter,transform] duration-[var(--duration-state)] ease-[var(--ease-enter)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        style={{
          borderColor: "var(--color-copper)",
          background: "linear-gradient(180deg, rgba(201,163,106,0.08), rgba(201,163,106,0.18))",
          boxShadow: "inset 0 0 24px rgba(201, 163, 106, 0.18), 0 12px 28px -16px rgba(201, 163, 106, 0.45)",
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: "var(--color-copper)",
            boxShadow: "0 0 10px var(--color-copper)",
          }}
        />
        Override and revoke
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Revoke this command grant?</DialogTitle>
          <DialogDescription>
            The vehicle returns to manual control on the next heartbeat. The revocation is
            written to the witness chain and cannot be undone.
          </DialogDescription>
          {canonicalBytesPreview ? (
            <GlassPanel
              variant="muted"
              className="mt-6 max-h-[180px] overflow-auto !p-4"
            >
              <p className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                Canonical bytes (RFC 8785)
              </p>
              <pre className="mt-2 luxe-mono text-[length:var(--text-small)] leading-[1.55] text-pearl whitespace-pre-wrap break-all">
                {canonicalBytesPreview}
              </pre>
            </GlassPanel>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Stay autonomous
            </Button>
            <Button variant="danger" onClick={handleConfirm} loading={busy} loadingText="Revoking">
              Override and revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
