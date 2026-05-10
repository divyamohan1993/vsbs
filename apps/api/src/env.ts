import { z } from "zod";

// Centralised env-var resolver. Fails fast at startup if a required key
// is missing. Matches .env.example.
const ModeSchema = z.enum(["sim", "live", "mixed"]);

const EnvSchema = z
	.object({
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
		APP_DEMO_MODE: z
			.string()
			.transform((v) => v !== "false")
			.default("true"),
		APP_REGION: z.string().default("asia-south1"),
		APP_REGIONS: z.string().default("asia-south1,us-central1"),
		APP_REGION_RUNTIME: z.enum(["asia-south1", "us-central1"]).default("asia-south1"),
		APP_REGION_EU_BLOCK: z
			.string()
			.transform((v: string) => v === "true")
			.default("false"),
		APP_REGION_BASE_URL_ASIA_SOUTH1: z.string().url().optional(),
		APP_REGION_BASE_URL_US_CENTRAL1: z.string().url().optional(),
		APP_REGION_WEB_URL_ASIA_SOUTH1: z.string().url().optional(),
		APP_REGION_WEB_URL_US_CENTRAL1: z.string().url().optional(),
		IDENTITY_PLATFORM_SIGNING_KEY: z
			.string()
			.min(8)
			.default("vsbs-dev-identity-signing-key-change-me"),

		ANTHROPIC_API_KEY: z.string().min(1).optional(),
		ANTHROPIC_MODEL_OPUS: z.string().default("claude-opus-4-6"),
		ANTHROPIC_MODEL_HAIKU: z.string().default("claude-haiku-4-5-20251001"),
		ANTHROPIC_MANAGED_AGENTS_BETA: z.string().default("managed-agents-2026-04-01"),

		GOOGLE_CLOUD_PROJECT: z.string().default("dmjone"),
		GOOGLE_CLOUD_REGION: z.string().default("asia-south1"),
		GOOGLE_CLOUD_REGION_SECONDARY: z.string().default("us-central1"),
		VERTEX_AI_LOCATION: z.string().default("asia-south1"),
		VERTEX_GEMINI_MODEL: z.string().default("gemini-3-pro"),
		GEMINI_LIVE_MODEL: z.string().default("gemini-live-2.5-flash-native-audio"),

		MAPS_SERVER_API_KEY: z.string().optional(),
		MAPS_MODE: z.enum(["sim", "live"]).default("sim"),

		NHTSA_VPIC_BASE: z.string().url().default("https://vpic.nhtsa.dot.gov/api/vehicles"),

		// Auth
		AUTH_MODE: z.enum(["sim", "live"]).default("sim"),
		AUTH_OTP_LENGTH: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("6")
			.pipe(z.number().int().min(4).max(10)),
		AUTH_OTP_TTL_SECONDS: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("300"),
		AUTH_OTP_MAX_ATTEMPTS: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("5"),
		AUTH_OTP_LOCKOUT_SECONDS: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("900"),
		TWILIO_ACCOUNT_SID: z.string().optional(),
		TWILIO_AUTH_TOKEN: z.string().optional(),
		TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
		MSG91_AUTH_KEY: z.string().optional(),
		MSG91_TEMPLATE_ID: z.string().optional(),

		// Payments
		PAYMENT_MODE: z.enum(["sim", "live"]).default("sim"),
		PAYMENT_PROVIDER: z.enum(["razorpay", "stripe", "upi"]).default("razorpay"),
		RAZORPAY_KEY_ID: z.string().optional(),
		RAZORPAY_KEY_SECRET: z.string().optional(),
		RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
		STRIPE_SECRET_KEY: z.string().optional(),
		STRIPE_WEBHOOK_SECRET: z.string().optional(),

		// Sensors / Autonomy
		SENSORS_MODE: ModeSchema.default("mixed"),
		SMARTCAR_MODE: z.enum(["sim", "live"]).default("sim"),
		SMARTCAR_CLIENT_ID: z.string().optional(),
		SMARTCAR_CLIENT_SECRET: z.string().optional(),
		SMARTCAR_REDIRECT_URI: z.string().optional(),
		OBD_DONGLE_MODE: z.enum(["sim", "live"]).default("sim"),
		AUTONOMY_ENABLED: z
			.string()
			.transform((v: string) => v === "true")
			.default("false"),
		AUTONOMY_MODE: z.enum(["sim", "live"]).default("sim"),
		AUTONOMY_DEFAULT_AUTOPAY_CAP_INR: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("0"),
		AUTONOMY_DEFAULT_AUTOPAY_CAP_USD: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("0"),

		// Mercedes-Bosch Intelligent Park Pilot (AVP) adapter.
		MERCEDES_IPP_MODE: z.enum(["sim", "live"]).default("sim"),
		MERCEDES_IPP_BASE: z.string().url().optional(),
		MERCEDES_IPP_TOKEN: z.string().optional(),

		// LLM layer — provider-agnostic, see packages/llm
		LLM_PROFILE: z.enum(["sim", "demo", "prod", "custom"]).default("sim"),
		GOOGLE_AI_STUDIO_API_KEY: z.string().optional(),
		OPENAI_API_KEY: z.string().optional(),

		// -------- Session signing (HMAC-SHA-256 bearer tokens) --------
		// Default fails the production superRefine below; rotate via Secret Manager.
		SESSION_SIGNING_KEY: z
			.string()
			.min(32)
			.default("vsbs-dev-session-signing-key-change-me-please-32+"),
		SESSION_TTL_SECONDS: z
			.string()
			.transform((v: string) => Number.parseInt(v, 10))
			.default("86400")
			.pipe(z.number().int().min(60).max(604800)),

		// -------- Admin auth (Cloud IAP in live, HMAC dev token in sim) --------
		ADMIN_AUTH_MODE: z.enum(["sim", "live"]).default("sim"),
		GCP_IAP_AUDIENCE: z.string().optional(),
		GCP_IAP_ISSUER: z.string().default("https://cloud.google.com/iap"),
		GCP_IAP_JWKS_URL: z.string().url().default("https://www.gstatic.com/iap/verify/public_key-jwk"),
	})
	.superRefine((env, ctx) => {
		if (env.NODE_ENV !== "production") return;

		// -------------------------------------------------------------------------
		// Production fail-closed enforcement (finding F9 of the security audit).
		// Every sim default that would let a misconfigured prod silently accept
		// forged tokens / fake payments / sim grants is blocked here at boot.
		// -------------------------------------------------------------------------
		const live = (key: keyof typeof env, expected: string): void => {
			if (env[key] !== expected) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [key as string],
					message: `production requires ${key}="${expected}", got "${String(env[key])}"`,
				});
			}
		};

		live("AUTH_MODE", "live");
		live("PAYMENT_MODE", "live");
		live("AUTONOMY_MODE", "live");
		live("MERCEDES_IPP_MODE", "live");
		live("MAPS_MODE", "live");
		live("ADMIN_AUTH_MODE", "live");

		if (env.LLM_PROFILE === "sim") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["LLM_PROFILE"],
				message: 'production must not run with LLM_PROFILE="sim"',
			});
		}

		if (env.SESSION_SIGNING_KEY === "vsbs-dev-session-signing-key-change-me-please-32+") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["SESSION_SIGNING_KEY"],
				message:
					"production must override the default SESSION_SIGNING_KEY (rotate via Secret Manager)",
			});
		}
		if (env.IDENTITY_PLATFORM_SIGNING_KEY === "vsbs-dev-identity-signing-key-change-me") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["IDENTITY_PLATFORM_SIGNING_KEY"],
				message: "production must override the default IDENTITY_PLATFORM_SIGNING_KEY",
			});
		}
		if (!env.GCP_IAP_AUDIENCE || env.GCP_IAP_AUDIENCE.length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["GCP_IAP_AUDIENCE"],
				message:
					"production requires GCP_IAP_AUDIENCE (the backend service /projects/<num>/global/backendServices/<id>)",
			});
		}
	});

export type Env = z.infer<typeof EnvSchema>;

type EnvSource = Record<string, string | undefined>;

declare const process: { env: EnvSource } | undefined;

export function loadEnv(source?: EnvSource): Env {
	const src: EnvSource = source ?? (typeof process !== "undefined" && process ? process.env : {});
	const parsed = EnvSchema.safeParse(src);
	if (!parsed.success) {
		console.error("[vsbs-api] invalid environment:", parsed.error.flatten());
		throw new Error("Invalid environment");
	}
	return parsed.data;
}
