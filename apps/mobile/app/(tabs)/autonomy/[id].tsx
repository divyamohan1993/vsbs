// Autonomy dashboard. Shows command-grant status, per-tier capability,
// and Issue / Revoke actions. Issuing a grant triggers the on-device
// passkey flow via grant-signing.ts; the resulting AutonomyAction chain
// is verified on receipt before we render the dashboard as "active".

import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Toast from "react-native-toast-message";

import { Banner, Button, Card, Screen } from "@/components/index";
import { useI18n } from "@/i18n/index";
import { requestAndSignGrant, GrantSigningError } from "@/lib/grant-signing";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api";
import { useTheme } from "@/theme/index";
import type { CommandGrant, AutonomyAction } from "@vsbs/shared";
import { z } from "zod";

const RP_ID_DEFAULT = "vsbs.dmj.one";

export default function AutonomyScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "demo";
  const { t } = useI18n();
  const { palette, spacing, typography } = useTheme();

  const [grant, setGrant] = useState<CommandGrant | null>(null);
  const [chain, setChain] = useState<AutonomyAction[]>([]);
  const [busy, setBusy] = useState(false);

  async function issueGrant() {
    setBusy(true);
    try {
      const res = await requestAndSignGrant({
        vehicleId: id,
        granteeSvcCenterId: "demo-svc-center",
        rpId: RP_ID_DEFAULT,
      });
      setGrant(res.grant);
      setChain(res.chain);
      track("autonomy_grant_signed", { result: "ok", grantId: res.grant.grantId });
      Toast.show({ type: "success", text1: "Grant issued" });
    } catch (err) {
      track("autonomy_grant_signed", { result: "fail" });
      const m = err instanceof GrantSigningError ? `${err.code}: ${err.message}` : (err as Error).message;
      Toast.show({ type: "error", text1: m });
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant() {
    if (!grant) return;
    setBusy(true);
    try {
      await apiClient.request(
        `/v1/autonomy/grant/${encodeURIComponent(grant.grantId)}/revoke`,
        z.object({ ok: z.literal(true) }),
        { method: "POST", body: { reason: "owner-revoked" } },
      );
      setGrant(null);
      setChain([]);
      track("autonomy_grant_revoked", { result: "ok" });
      Toast.show({ type: "success", text1: "Grant revoked" });
    } catch (err) {
      track("autonomy_grant_revoked", { result: "fail" });
      Toast.show({ type: "error", text1: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Banner text={t.demo.banner} variant="warn" />
      <Text style={{ ...typography.headline, color: palette.onBackground }}>
        {t.autonomy.title}: {id}
      </Text>

      <Card title={grant ? t.autonomy.grantActive : t.autonomy.grantInactive}>
        {grant ? (
          <View style={{ gap: spacing.s }}>
            <Text style={{ ...typography.body, color: palette.onSurface }}>Tier: {grant.tier}</Text>
            <Text style={{ ...typography.body, color: palette.onSurface }}>
              Scopes: {grant.scopes.join(", ")}
            </Text>
            <Text style={{ ...typography.body, color: palette.onSurface }}>
              Cap: ₹{grant.maxAutoPayInr.toLocaleString("en-IN")}
            </Text>
            <Text style={{ ...typography.body, color: palette.onSurface }}>
              Expires: {new Date(grant.notAfter).toLocaleString()}
            </Text>
            <Text style={{ ...typography.caption, color: palette.muted }}>
              Authority chain length: {chain.length}
            </Text>
            <Button label={t.autonomy.revokeGrant} variant="danger" onPress={revokeGrant} loading={busy} fullWidth />
          </View>
        ) : (
          <Button label={t.autonomy.issueGrant} onPress={issueGrant} loading={busy} fullWidth testID="issue-grant" />
        )}
      </Card>

      {chain.length > 0 ? (
        <Card title="Authority chain">
          {chain.slice(-5).map((action) => (
            <View key={action.actionId} style={{ paddingVertical: spacing.xs }}>
              <Text style={{ ...typography.caption, color: palette.muted }}>
                {new Date(action.timestamp).toLocaleTimeString()}
              </Text>
              <Text style={{ ...typography.body, color: palette.onSurface }}>{action.kind}</Text>
              <Text style={{ ...typography.caption, color: palette.muted, fontFamily: "Courier" }} numberOfLines={1}>
                {action.chainHash}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
