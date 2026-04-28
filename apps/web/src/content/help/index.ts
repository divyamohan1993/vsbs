// Help-centre article registry. The content lives inline so a server
// component can render it without any fs traversal at request time and
// the build emits the article body into the static bundle directly.
// The shape mirrors what a markdown loader would produce, so swapping
// to a real markdown source later is a structural change only.

export interface HelpArticle {
  slug: string;
  title: string;
  body: string;
}

const GETTING_STARTED = `# Getting started with VSBS

VSBS is the Autonomous Vehicle Service Booking System. It books you a service appointment, recommends what to do based on what your vehicle is telling it, and (when your OEM supports autonomy) hands the car over to the service centre under a signed command grant.

## What you can do here

- Book a service in four short steps. The fifth step is an autonomous concierge that runs your safety, wellbeing, and dispatch checks before it confirms anything.
- Check live status of an in-progress booking.
- See the autonomy dashboard for your booking — sensors, prognostics, and command grants in plain language.
- Manage your DPDP consents on the **Your consents** page.

## Three ground rules

1. Safety overrides everything. If a red flag is set, you cannot drive the car; we will dispatch a tow.
2. Every recommendation has a rationale you can read.
3. You can revoke a command grant at any time. The override button is large and red on purpose.
`;

const BOOKING_A_SERVICE = `# Booking a service

The booking flow is four short steps and a final autonomous turn.

1. **Sign in** with your phone number. We send a one-time code by SMS. In demo mode the code is shown to you on screen.
2. **Identify your vehicle** by VIN, or enter make/model/year if you do not have a VIN handy. The VIN is decoded against the NHTSA vPIC database.
3. **Symptoms.** Describe what is happening in your own words. Tell us whether the car is safe to drive right now and tick any of the listed red flags that apply.
4. **Review.** Confirm the booking. The autonomous concierge then runs the safety, wellbeing, and dispatch checks and proposes either a service appointment or a tow.

You can also start with **voice**, **photo**, or **noise** intake. Use the page that matches what you have to share — a description, a picture of the dash, or a recording of the sound.
`;

const VOICE_INTAKE = `# Voice intake

Use voice when typing is awkward. Press **Start listening** and describe the problem in your own words. We show a partial transcript as you speak; you can edit it before submitting.

If we are speaking back to you and you start a new utterance, the speech is cancelled immediately. This is called barge-in and it works the way you would expect from a phone call.

Voice intake never stores raw audio. The transcript is what we keep, and only with your consent for "voice and photo processing for diagnosis".
`;

const PHOTO_UPLOAD = `# Photo upload

Photos help us see what you see. The most useful pictures are:

- **Dashcam / instrument cluster**: warning lights, error codes, mileage.
- **Exterior**: any visible damage, fluid leaks, smoke.
- **Underbody**: only if it is safe to look. Never get under a vehicle that is not on stands.

We strip EXIF metadata in the browser before upload, compress under 1 MiB, and never store the raw camera frame. If your camera is unavailable you can pick a saved file instead.
`;

const AUTONOMY_HANDOFF = `# Autonomy handoff

If your vehicle and your OEM both support autonomy, we can pick the car up from a designated parking spot and take it to the service centre on its own. This is called Automated Valet Parking (AVP) under UNECE R157.

Handoff is not silent. We tell you exactly:

- The autonomy tier (e.g. UNECE R157 SAE L4 vehicle-only).
- The geofence (e.g. APCOA Stuttgart P6).
- The time-to-live of the grant.
- The signature chain — algorithm, canonical bytes preview, and witness Merkle roots.

You can revoke the grant at any time from the autonomy dashboard. The vehicle returns to manual control on the next heartbeat.
`;

const COMMAND_GRANTS = `# Command grants

A command grant is a signed authorisation from you to a service centre to perform a specific set of actions on your vehicle, for a specific time, under a specific tier.

Each grant carries:

- A **scope** list (e.g. \`acceptHandoff\`, \`performScope:park\`, \`performScope:returnToOwner\`).
- A **tier** that names the autonomy regulation it operates under.
- A **TTL** — the grant expires automatically.
- A **signature chain** verified against the OEM's public keys, hashed with SHA-256, and witnessed by VSBS, the OEM, and the geofence operator.

The canonical bytes use RFC 8785 (JSON Canonicalisation Scheme) so that the signature is deterministic across implementations.
`;

const PAYMENTS = `# Payments

Payments are processed by Razorpay. We never see your card number — Razorpay handles the PCI side end to end. You authorise an amount, the service centre captures it on completion, and the receipt lands in your inbox.

If you opted into **auto-pay within the cap I set**, we will capture amounts up to your declared cap automatically. Anything above the cap requires your explicit one-tap approval.

In demo mode no real money moves. The state machine — created, intent, authorised, captured, refunded — is identical to live mode so the UI behaves the same.
`;

const REFUNDS = `# Refunds

Refunds follow the Razorpay state machine: a refund can be issued against an authorised or captured payment up to the captured amount. Partial refunds are allowed.

We initiate a refund automatically if a service is cancelled before authorisation, or if a captured charge does not match the agreed scope. You can also request a refund manually by contacting support.

In demo mode the refund webhook fires after a deterministic delay so the UI shows the same banner you would see in production.
`;

const DELETION_AND_ERASURE = `# Deletion and erasure

Under DPDP Act 2023 you can ask us to delete your data. The **Your consents** page has a **Delete my data** action that:

1. Removes your records from the live database.
2. Triggers a removal job against backups, logs, caches, and analytics.
3. Sends you a deletion certificate by email when the chain is complete (within 30 days).

Some retention is mandated by law (for example, transaction logs that must be retained for the statutory period). We tell you which records are retained and why, and we strip every personal identifier from them.
`;

const CONTACT_SUPPORT = `# Contact support

The fastest way to reach us is through the chat icon on any page. The conversation is logged with a request ID you can quote in email if you need a written record.

Email: contact@dmj.one

If your concern is about safety on the road right now, do not contact support first. Pull over safely and call your local emergency number.
`;

const RAW: { slug: string; raw: string }[] = [
  { slug: "getting-started", raw: GETTING_STARTED },
  { slug: "booking-a-service", raw: BOOKING_A_SERVICE },
  { slug: "voice-intake", raw: VOICE_INTAKE },
  { slug: "photo-upload", raw: PHOTO_UPLOAD },
  { slug: "autonomy-handoff", raw: AUTONOMY_HANDOFF },
  { slug: "command-grants", raw: COMMAND_GRANTS },
  { slug: "payments", raw: PAYMENTS },
  { slug: "refunds", raw: REFUNDS },
  { slug: "deletion-and-erasure", raw: DELETION_AND_ERASURE },
  { slug: "contact-support", raw: CONTACT_SUPPORT },
];

function deriveTitle(raw: string, slug: string): string {
  const m = raw.match(/^#\s+(.+?)\s*$/m);
  return m && m[1] ? m[1] : slug.replace(/-/g, " ");
}

export const HELP_ARTICLES: HelpArticle[] = RAW.map(({ slug, raw }) => ({
  slug,
  title: deriveTitle(raw, slug),
  body: raw,
}));

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
