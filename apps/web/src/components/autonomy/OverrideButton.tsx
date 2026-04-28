"use client";

import { useState } from "react";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../ui/Dialog";

interface Props {
  grantId: string | null;
  onRevoked: (grantId: string) => void;
  onError: (message: string) => void;
}

export function OverrideButton({ grantId, onRevoked, onError }: Props): React.JSX.Element {
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
      <Button
        variant="danger"
        size="lg"
        disabled={!grantId}
        onClick={() => setOpen(true)}
        className="w-full"
      >
        Override and revoke
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Revoke this command grant?</DialogTitle>
          <DialogDescription>
            The vehicle will return to manual control on the next heartbeat. This action is logged
            on the witness chain and cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Keep grant active
            </Button>
            <Button variant="danger" onClick={handleConfirm} loading={busy} loadingText="Revoking">
              Revoke now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
