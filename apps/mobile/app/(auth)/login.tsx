// Phone-OTP login screen. Mirrors the web Step 1 flow:
//   1. User enters E.164 phone number.
//   2. We POST /v1/auth/otp/start. In sim/demo mode the response includes
//      `demoCode` so the UI can autofill the input — the verify step still
//      goes through the same code path as live.
//   3. We POST /v1/auth/otp/verify with the entered code.
//   4. On success the API hands back an HMAC-signed session bearer
//      (`sessionToken`) + ISO `expiresAt`. We persist both in the iOS
//      Keychain / Android Keystore via expo-secure-store. The bearer is
//      what every authenticated API call sends; the subject is purely a
//      UX label.

import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Toast from "react-native-toast-message";

import { Banner, Button, Card, Screen, TextField } from "@/components/index";
import { useI18n } from "@/i18n/index";
import { track } from "@/lib/analytics";
import { ApiError, apiClient } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useTheme } from "@/theme/index";

export default function LoginScreen() {
	const { t } = useI18n();
	const { palette, spacing, typography } = useTheme();
	const router = useRouter();
	const { signIn } = useAuth();

	const [phone, setPhone] = useState("");
	const [challengeId, setChallengeId] = useState<string | null>(null);
	const [demoCode, setDemoCode] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
	const [otpError, setOtpError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	async function handleSendOtp() {
		setPhoneError(undefined);
		if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
			setPhoneError(t.auth.errors.phoneInvalid);
			return;
		}
		setBusy(true);
		try {
			const res = await apiClient.otpStart({
				phone,
				purpose: "login",
				locale: "en",
			});
			setChallengeId(res.challengeId);
			setDemoCode(res.demoCode ?? null);
			if (res.demoCode) setCode(res.demoCode);
			track("auth_otp_started", { result: "ok" });
		} catch (err) {
			track("auth_otp_started", { result: "fail" });
			const message = err instanceof ApiError ? err.message : t.auth.errors.networkFail;
			Toast.show({ type: "error", text1: message });
		} finally {
			setBusy(false);
		}
	}

	async function handleVerify() {
		setOtpError(undefined);
		if (!challengeId) return;
		if (code.length < 4) {
			setOtpError(t.auth.errors.otpInvalid);
			return;
		}
		setBusy(true);
		try {
			const res = await apiClient.otpVerify({ challengeId, code });
			if (!res.sessionToken) {
				throw new ApiError({
					code: "OTP_NO_SESSION_TOKEN",
					message: "OTP verify did not return a session token",
					status: 500,
				});
			}
			await signIn({
				token: res.sessionToken,
				subject: res.subject,
				...(res.expiresAt !== undefined ? { expiresAt: res.expiresAt } : {}),
			});
			track("auth_otp_verified", { result: "ok" });
			router.replace("/(tabs)");
		} catch (err) {
			track("auth_otp_verified", { result: "fail" });
			const message = err instanceof ApiError ? err.message : t.auth.errors.otpInvalid;
			setOtpError(message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<Banner text={t.demo.banner} variant="warn" />
			<View style={{ gap: spacing.s }}>
				<Text style={{ ...typography.display, color: palette.onBackground }}>{t.auth.title}</Text>
				<Text style={{ ...typography.body, color: palette.muted }}>{t.auth.subtitle}</Text>
			</View>
			<Card>
				<TextField
					label={t.auth.phoneLabel}
					placeholder={t.auth.phonePlaceholder}
					value={phone}
					onChangeText={setPhone}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="phone-pad"
					textContentType="telephoneNumber"
					error={phoneError}
					editable={!challengeId}
					accessibilityLabel={t.auth.phoneLabel}
				/>
				{!challengeId ? (
					<Button
						label={t.auth.sendOtp}
						onPress={handleSendOtp}
						loading={busy}
						fullWidth
						testID="send-otp"
					/>
				) : (
					<View style={{ gap: spacing.m }}>
						{demoCode ? <Banner text={`${t.auth.demoCode}: ${demoCode}`} variant="info" /> : null}
						<TextField
							label={t.auth.otpLabel}
							value={code}
							onChangeText={setCode}
							keyboardType="number-pad"
							maxLength={10}
							error={otpError}
							testID="otp-input"
						/>
						<Button
							label={t.auth.verify}
							onPress={handleVerify}
							loading={busy}
							fullWidth
							testID="verify-otp"
						/>
					</View>
				)}
			</Card>
		</Screen>
	);
}
