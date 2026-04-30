import Link from "next/link";
import {
  Brand,
  GlassPanel,
  GoldSeal,
  Hero,
  KPIBlock,
  SpecLabel,
  SpecValue,
} from "../components/luxe";

const PROMISES = [
  {
    label: "Autonomous booking",
    body: "Describe the symptom. We diagnose, schedule, and explain every recommendation in plain English.",
  },
  {
    label: "Predictive health",
    body: "Sensor fusion, physics-of-failure prognostics, and a wellbeing score you can read at a glance.",
  },
  {
    label: "Signed handover",
    body: "When the OEM supports it, the car is dispatched under a cryptographic capability you authorise and revoke.",
  },
] as const;

const KPIS = [
  { label: "Tests passing", value: "1 169", status: "ok" as const, description: "Across 6 packages, run on every push." },
  { label: "Live HTTP probes", value: "32", unit: "per build", status: "ok" as const, description: "Real schemas; no mocks at the boundary." },
  { label: "Mishandled grants", value: "0", status: "ok" as const, description: "Every command-grant verified end to end." },
];

export default async function HomePage(): Promise<React.JSX.Element> {
  return (
    <div className="space-y-[80px] md:space-y-[120px]">
      <Hero image="hero-eqs-garage.png" imagePortrait="hero-eqs-garage-portrait.png" height="tall">
        <div className="flex max-w-[820px] flex-col gap-8">
          <SpecLabel>Autonomous Vehicle Service</SpecLabel>
          <h1
            className="font-[family-name:var(--font-display)] text-[clamp(3rem,8vw,6rem)] font-medium leading-[1.02] tracking-[var(--tracking-tight)] text-pearl"
          >
            Your vehicle. Served.
          </h1>
          <p className="max-w-[560px] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
            Autonomous, audited, and on your schedule. The booking, the diagnosis, and the handover all in one calm motion.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link
              href={{ pathname: "/book" }}
              className="luxe-btn-primary inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-8 py-4 text-[var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
            >
              Book a service
            </Link>
            <Link
              href={{ pathname: "/autonomy/demo" }}
              className="luxe-glass inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-8 py-4 text-[var(--text-body)] tracking-[var(--tracking-wide)] text-pearl hover:[border-color:var(--color-hairline-hover)]"
            >
              See the live dashboard
            </Link>
          </div>
          <div aria-hidden="true" className="luxe-shimmer mt-6 h-px w-32 rounded-full" />
        </div>
      </Hero>

      <section aria-labelledby="promises" className="mx-auto w-full max-w-[1180px]">
        <div className="mb-10 flex flex-col gap-3">
          <SpecLabel>What we do</SpecLabel>
          <h2
            id="promises"
            className="font-[family-name:var(--font-display)] text-[var(--text-h2)] font-medium tracking-[var(--tracking-tight)] text-pearl"
          >
            Three promises. No theatre.
          </h2>
        </div>
        <ul className="grid gap-6 md:grid-cols-3">
          {PROMISES.map((p) => (
            <li key={p.label}>
              <GlassPanel interactive className="flex h-full flex-col gap-4">
                <SpecLabel>{p.label}</SpecLabel>
                <p className="text-[var(--text-body)] leading-[1.6] text-pearl">{p.body}</p>
              </GlassPanel>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kpis" className="mx-auto w-full max-w-[1180px]">
        <div className="mb-10 flex flex-col gap-3">
          <SpecLabel>Verified state</SpecLabel>
          <h2
            id="kpis"
            className="font-[family-name:var(--font-display)] text-[var(--text-h2)] font-medium tracking-[var(--tracking-tight)] text-pearl"
          >
            Numbers we publish. Every build.
          </h2>
        </div>
        <GlassPanel variant="elevated" className="!p-10">
          <ul className="grid gap-10 md:grid-cols-3">
            {KPIS.map((k) => (
              <li key={k.label}>
                <KPIBlock {...k} />
              </li>
            ))}
          </ul>
        </GlassPanel>
      </section>

      <section aria-labelledby="brief" className="mx-auto w-full max-w-[720px] text-center">
        <SpecLabel>The brief</SpecLabel>
        <blockquote className="mt-6">
          <p
            className="font-[family-name:var(--font-display)] text-[var(--text-h3)] italic leading-[1.35] text-pearl"
          >
            We took the customer experience of a Maybach showroom, the engineering rigour of an aerospace prognostics
            lab, and the privacy posture of a Swiss bank, and asked: what does a service booking feel like?
          </p>
          <footer className="mt-6">
            <SpecLabel>The brief</SpecLabel>
          </footer>
        </blockquote>
      </section>

      <section aria-labelledby="next" className="mx-auto w-full max-w-[1180px]">
        <GlassPanel className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <GoldSeal size={32} label="signed and witnessed" />
            <div className="flex flex-col gap-1">
              <SpecLabel>When you are ready</SpecLabel>
              <h2
                id="next"
                className="font-[family-name:var(--font-display)] text-[var(--text-h4)] font-medium tracking-[var(--tracking-tight)] text-pearl"
              >
                The booking takes ninety seconds.
              </h2>
            </div>
          </div>
          <Link
            href={{ pathname: "/book" }}
            className="luxe-btn-primary inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-8 py-4 text-[var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
          >
            Begin
          </Link>
        </GlassPanel>
      </section>

      <section aria-labelledby="origin" className="mx-auto w-full max-w-[1180px]">
        <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
          <div className="flex flex-col gap-4">
            <Brand size="sm" />
            <SpecLabel>Provenance</SpecLabel>
            <SpecValue value="2026" unit="prior art filed" size="md" />
            <p className="text-[var(--text-control)] leading-[1.7] text-pearl-muted">
              VSBS is the work of Divya Mohan at dmj.one. Apache 2.0. The defensive publication is dated April 2026 and
              names twelve concepts whose ownership we wish to make permanent and free.
            </p>
          </div>
          <GlassPanel variant="muted" className="flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-3">
              <SpecLabel>Engineering posture</SpecLabel>
              <p className="text-[var(--text-body)] leading-[1.7] text-pearl">
                Every external dependency runs in a simulator that is bit-identical to the live driver. Every safety
                red-flag is hard-coded and double-checked. Every recommendation is auditable by you.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-4 text-[var(--text-control)] text-pearl-muted">
              <li>WCAG 2.2 AAA</li>
              <li>DPDP-native</li>
              <li>PQ-hybrid TLS</li>
              <li>SLSA L3 signed</li>
            </ul>
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}
