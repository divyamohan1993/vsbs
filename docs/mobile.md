# VSBS Owner — Mobile App

> Phase 9 of [docs/roadmap-prod-deploy.md](roadmap-prod-deploy.md). React Native / Expo SDK 53 owner-facing app, sharing every contract with the web client via `@vsbs/shared`.

## What it is

`apps/mobile` is the second user-facing surface in the VSBS family, sitting alongside `apps/web`. It is **the** offline-first surface — the web app degrades to "show last cache" but the mobile app actively queues writes, syncs when connectivity returns, and ingests live OBD-II telemetry from the vehicle's BLE dongle. It is also where the on-device passkey lives: command grants for autonomous handoff are signed on the phone, never on the server.

| Surface | Role |
|---|---|
| `apps/web` | First-time owners, desktop scheduling, autonomy dashboard at the service centre |
| `apps/mobile` | Daily ownership: live status, in-vehicle BLE OBD ingest, passkey-signed grants, push notifications |
| `apps/api` | Single API behind both — same contracts in `@vsbs/shared` |

## Stack

- **Expo SDK 53** with the new React Native architecture (Hermes + Fabric + TurboModules).
- **React 19** + **react-native 0.79**.
- **Expo Router 5** for filesystem-based routing (`app/`).
- **TypeScript 5.5+** with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Zod** for every wire-level boundary, schemas inherited from `@vsbs/shared`.
- **Jest + ts-jest** for unit tests. We deliberately skip `jest-expo` for unit tests because pulling in the RN setup tree breaks parser-level on Flow-typed polyfills; pure-logic tests (Zod schemas, OBD parser, theme tokens, SSE parser, offline outbox, analytics, grant chain) run in node + ts-jest, and any UI rendering test would belong in Detox / Maestro at the e2e tier.

## Routes

```
app/
  _layout.tsx                  ThemeProvider + I18nProvider + AuthProvider
  index.tsx                    redirect to (auth) or (tabs) based on session
  (auth)/
    _layout.tsx
    login.tsx                  phone OTP flow (sim/demo banner + autofill)
  (tabs)/
    _layout.tsx                bottom tab bar
    index.tsx                  home (active booking summary + CTAs)
    book.tsx                   4+1 step booking wizard with concierge SSE
    status/[id].tsx            live booking status (SSE timeline)
    autonomy/[id].tsx          command-grant issue / revoke + chain view
    me.tsx                     profile + theme + locale + consent + erasure
```

## Library modules

```
src/
  lib/
    api.ts                     VsbsApiClient on fetch; Zod-validated envelopes;
                               idempotency key per mutation
    passkey.ts                 expo-local-authentication + react-native-passkey;
                               step-up biometric, register / sign-in / assert-over-challenge
    grant-signing.ts           on-device CommandGrant flow:
                               canonical RFC-8785 bytes -> SHA-256 challenge ->
                               passkey assertion -> server witness round-trip ->
                               authority-chain verification
    notifications.ts           expo-notifications register + HMAC verify;
                               5 notification kinds; PII-free body
    ble-obd.ts                 ELM327 / vLinker MS BLE driver (live) + sim source;
                               SAE J1979 PID parser (RPM, speed, coolant, load,
                               throttle, fuel level, baro, intake-temp)
    camera.ts                  expo-camera capture + EXIF strip + multipart upload
    audio.ts                   expo-av engine / brake noise capture + upload
    region.ts                  asia-south1 / us-central1 selection (locale + pin)
    sse.ts                     POST-stream SSE parser (mirrors apps/web)
    offline.ts                 AsyncStorage outbox with exponential backoff
    analytics.ts               PII-free local event queue
  i18n/
    messages.ts                en + hi catalogues; 8 more locales aliased to en
    provider.tsx               I18nContext, locale persistence
  theme/
    tokens.ts                  OKLCH palette ported to RN sRGB hex
    provider.tsx               ThemeContext (light / dark / high-contrast)
  components/
    Button, Card, TextField, Banner, Screen
                               44pt min target, accessibilityRole/State,
                               reduced-motion via react-native-reanimated
  providers/
    auth.tsx                   session token + subject in expo-secure-store
```

## How to run

The app is workspace-published as `@vsbs/mobile`.

```bash
cd /mnt/experiments/vehicle-service-booking-system
pnpm install --ignore-scripts

pnpm --filter @vsbs/mobile typecheck
pnpm --filter @vsbs/mobile test

# Local dev (point at the local API):
EXPO_PUBLIC_DEMO=1 pnpm --filter @vsbs/mobile start
# then press "i" for iOS simulator, "a" for Android, "w" for web
```

## Build profiles

`eas.json` declares three EAS profiles:

| Profile | Distribution | Notes |
|---|---|---|
| `development` | internal | dev client, simulator-friendly |
| `preview` | internal | release-mode APK / unsigned IPA for QA |
| `production` | store | signed App Store / Play Store bundles, autoIncrement on |

Build commands:

```bash
eas login
eas build --profile development --platform ios
eas build --profile preview --platform android
eas build --profile production --platform all
```

## Permissions and PII rules

| Permission | Why | Strict scope |
|---|---|---|
| Camera | photograph instrument cluster, damage | EXIF stripped before upload |
| Microphone | engine / brake noise capture | session-scoped only |
| Bluetooth | ELM327 / vLinker MS OBD-II dongle | service UUID filter |
| Push notifications | booking + autonomy events | HMAC verified before display |
| Location (when in use) | nearest service centre, geofence validation | never logged |
| Biometrics | passkey step-up before signing grants | platform passkey only |

Rules: no analytics SDK that ships PII offshore. The local analytics queue uses a fixed-shape props object (see [`src/lib/analytics.ts`](../apps/mobile/src/lib/analytics.ts)); free-form strings are not allowed. PII never appears in notification bodies — the body shows `kind` + `bookingId` only and the user-facing string is composed on-device with i18n.

## Store-submission checklist

Before submitting to App Store / Play Store:

- [ ] Replace `appleTeamId` and `ascAppId` placeholders in [`eas.json`](../apps/mobile/eas.json).
- [ ] Add real `assets/icon.png`, `splash.png`, `adaptive-icon.png`, `favicon.png` (currently directory holds only this list).
- [ ] Generate Apple Pay / Google Pay merchant identifiers if production payments are enabled.
- [ ] Add the iOS `applinks:` and `webcredentials:` entitlements to the Apple Developer portal so passkeys bind to `vsbs.dmj.one`.
- [ ] Provision an Android Digital Asset Links file at `https://vsbs.dmj.one/.well-known/assetlinks.json` so deep links auto-verify.
- [ ] Submit privacy nutrition labels declaring: phone number (auth), camera + mic (intake), bluetooth (diagnostic). Mark all categories as "Used to provide functionality of the app — not linked to user".
- [ ] Run accessibility audit with iOS Accessibility Inspector and Android Accessibility Scanner; aim for AAA contrast on every screen.
- [ ] Run external security audit per Phase 12 §86.

## Related docs

- [docs/roadmap-prod-deploy.md](roadmap-prod-deploy.md) §70-72 — Phase 9 task list.
- [docs/research/autonomy.md](research/autonomy.md) §5 — capability model.
- [docs/simulation-policy.md](simulation-policy.md) — sim driver parity rule.
- [docs/research/security.md](research/security.md) §7 — passkey + grant signing.
- [packages/shared/src/commandgrant-lifecycle.ts](../packages/shared/src/commandgrant-lifecycle.ts) — canonical bytes + chain helpers reused on-device.
