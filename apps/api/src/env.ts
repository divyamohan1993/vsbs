import { z } from "zod";

// Centralised env-var resolver. Fails fast at startup if a required key
// is missing. Matches .env.example.
const ModeSchema = z.enum(["sim", "live", "mixed"]);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  APP_DEMO_MODE: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  APP_REGION: z.string().default("asia-south1"),
  APP_REGIONS: z.string().default("asia-south1,us-central1"),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL_OPUS: z.string().default("claude-opus-4-6"),
  ANTHROPIC_MODEL_HAIKU: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MANAGED_AGENTS_BETA: z.string().default("managed-agents-2026-04-01"),

  GOOGLE_CLOUD_PROJECT: z.string().default("lmsforshantithakur"),
  GOOGLE_CLOUD_REGION: z.string().default("asia-south1"),
  GOOGLE_CLOUD_REGION_SECONDARY: z.string().default("us-central1"),
  VERTEX_AI_LOCATION: z.string().default("asia-south1"),
  VERTEX_GEMINI_MODEL: z.string().default("gemini-3-pro"),
  GEMINI_LIVE_MODEL: z.string().default("gemini-live-2.5-flash-native-audio"),

  MAPS_SERVER_API_KEY: z.string().optional(),
  MAPS_MODE: z.enum(["sim", "live"]).default("sim"),

  NHTSA_VPIC_BASE: z
    .string()
    .url()
    .default("https://vpic.nhtsa.dot.gov/api/vehicles"),

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

  // LLM layer — provider-agnostic, see packages/llm
  LLM_PROFILE: z.enum(["sim", "demo", "prod", "custom"]).default("sim"),
  GOOGLE_AI_STUDIO_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

type EnvSource = Record<string, string | undefined>;

declare const process: { env: EnvSource } | undefined;

export function loadEnv(source?: EnvSource): Env {
  const src: EnvSource =
    source ?? (typeof process !== "undefined" && process ? process.env : {});
  const parsed = EnvSchema.safeParse(src);
  if (!parsed.success) {
    console.error("[vsbs-api] invalid environment:", parsed.error.flatten());
    throw new Error("Invalid environment");
  }
  return parsed.data;
}
