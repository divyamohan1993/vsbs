"use client";

// SensorSuite — every channel a real-world L5 stack publishes off-vehicle.
//
// Renders, in order:
//   1. Sensor census (cameras, radars, lidars, thermal, audio, ultrasonic)
//   2. BEV occupancy mini-map + nearest tracks
//   3. Localization (multi-constellation GNSS + RTK + IMU)
//   4. Vehicle dynamics (wheels, chassis, friction)
//   5. Powertrain (motors, inverter, HV bus, 96-cell pack heat-map)
//   6. Compute & lockstep + HSM
//   7. Network (5G/MEC, HD-map sync)
//   8. V2X bus (BSM, SPaT, MAP, CAM, DENM)
//   9. Safety / SOTIF (ODD, OOD, R157 ladder, capability budget, MRM)
//  10. Cabin + driver attention + air quality
//  11. Environment (weather, friction, time-of-day)
//  12. Software stack version footer
//
// Every section degrades gracefully when a channel is absent so a partial
// bridge (early CARLA scenario, replay trace, real OEM in restricted ODD)
// still produces a coherent dashboard.

import type { CSSProperties } from "react";
import { GlassPanel, SpecLabel } from "../luxe";
import { StatusPill } from "./luxe/StatusPill";
import type {
  TelemetryFrame,
  SensorHealth,
} from "./useTelemetryStream";

interface Props {
  frame: TelemetryFrame;
}

export function SensorSuite({ frame }: Props): React.JSX.Element {
  return (
    <div className="space-y-12">
      <SensorCensus frame={frame} />
      <PerceptionSection frame={frame} />
      <LocalizationSection frame={frame} />
      <DynamicsSection frame={frame} />
      <PowertrainSection frame={frame} />
      <ComputeSection frame={frame} />
      <NetworkSection frame={frame} />
      <V2xSection frame={frame} />
      <SafetySection frame={frame} />
      <CabinSection frame={frame} />
      <EnvironmentSection frame={frame} />
      <SoftwareFooter frame={frame} />
    </div>
  );
}

// --- Section: sensor census -----------------------------------------------

function SensorCensus({ frame }: Props): React.JSX.Element {
  const groups: Array<{ label: string; items: SensorHealth[] }> = [
    { label: "Cameras", items: frame.sensors?.cameras ?? [] },
    { label: "Imaging radar (4D)", items: frame.sensors?.radars ?? [] },
    { label: "Solid-state LiDAR", items: frame.sensors?.lidars ?? [] },
    { label: "Thermal IR (LWIR)", items: frame.sensors?.thermal ?? [] },
    { label: "Audio array", items: frame.sensors?.microphones ?? [] },
    { label: "Ultrasonic (legacy)", items: frame.sensors?.ultrasonic ?? [] },
  ];
  return (
    <Section title="Sensor suite" eyebrow="Surround perception" right={<SpecLabel>{countAll(frame)}</SpecLabel>}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <SensorGroup key={g.label} label={g.label} items={g.items ?? []} />
        ))}
      </div>
    </Section>
  );
}

function SensorGroup({ label, items }: { label: string; items: SensorHealth[] }): React.JSX.Element {
  return (
    <GlassPanel variant="muted" className="!p-5">
      <div className="flex items-baseline justify-between gap-2">
        <SpecLabel>{label}</SpecLabel>
        <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          {items.length || "—"}
        </span>
      </div>
      <ul className="mt-4 space-y-3">
        {items.length === 0 ? (
          <li className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            no instances reported
          </li>
        ) : (
          items.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[length:var(--text-control)] text-pearl truncate">{s.label}</div>
                <div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                  {[
                    s.hz !== undefined ? `${s.hz} Hz` : null,
                    s.fovDeg !== undefined ? `${s.fovDeg}° FoV` : null,
                    s.rangeM !== undefined ? `${s.rangeM} m` : null,
                    s.returns !== undefined ? `${s.returns.toLocaleString()} ret` : null,
                    s.tempC !== undefined ? `${s.tempC} °C` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <SensorStatus status={s.status} />
            </li>
          ))
        )}
      </ul>
    </GlassPanel>
  );
}

function SensorStatus({ status }: { status: SensorHealth["status"] }): React.JSX.Element {
  const tone =
    status === "ok"
      ? ("ok" as const)
      : status === "watch"
        ? ("watch" as const)
        : status === "alert"
          ? ("halt" as const)
          : ("neutral" as const);
  return (
    <StatusPill tone={tone} size="sm">
      {status === "ok" ? "LIVE" : status.toUpperCase()}
    </StatusPill>
  );
}

function countAll(frame: TelemetryFrame): string {
  const s = frame.sensors;
  if (!s) return "no census";
  const tot =
    (s.cameras?.length ?? 0) +
    (s.radars?.length ?? 0) +
    (s.lidars?.length ?? 0) +
    (s.thermal?.length ?? 0) +
    (s.microphones?.length ?? 0) +
    (s.ultrasonic?.length ?? 0);
  return `${tot} channels`;
}

// --- Section: perception (BEV + tracks) ------------------------------------

function PerceptionSection({ frame }: Props): React.JSX.Element {
  const p = frame.perception;
  if (!p) return <></>;
  return (
    <Section title="Perception & fusion" eyebrow="BEV occupancy + tracked agents">
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <BevTile frame={frame} />
        <DetectionsTile frame={frame} />
      </div>
      {p.tracks && p.tracks.length > 0 ? <TracksTable tracks={p.tracks} /> : null}
    </Section>
  );
}

function BevTile({ frame }: Props): React.JSX.Element {
  const tracks = frame.perception?.tracks ?? [];
  const occ = frame.perception?.bevOccupancy;
  const tl = frame.perception?.trafficLight;
  return (
    <GlassPanel variant="muted" className="relative !p-5">
      <div className="flex items-baseline justify-between">
        <SpecLabel>BEV occupancy · 60 m</SpecLabel>
        <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          occ {(occ?.occupiedRatio ?? 0).toFixed(2)} · uncert {(occ?.peakUncertainty ?? 0).toFixed(2)}
        </span>
      </div>
      <div className="mt-4 relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] bg-[#0c0f14]">
        {/* Range rings */}
        <svg viewBox="-30 -30 60 60" className="absolute inset-0 h-full w-full">
          <defs>
            <radialGradient id="bev-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(108,160,210,0.18)" />
              <stop offset="100%" stopColor="rgba(8,9,12,0)" />
            </radialGradient>
          </defs>
          <rect x="-30" y="-30" width="60" height="60" fill="url(#bev-glow)" />
          {[10, 20, 30].map((r) => (
            <circle
              key={r}
              cx={0}
              cy={0}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={0.18}
            />
          ))}
          {/* Lane stripes (simplified) */}
          <line x1={-30} y1={-3} x2={30} y2={-3} stroke="rgba(201,163,106,0.18)" strokeWidth={0.18} strokeDasharray="2 2" />
          <line x1={-30} y1={3} x2={30} y2={3} stroke="rgba(201,163,106,0.18)" strokeWidth={0.18} strokeDasharray="2 2" />
          {/* Ego */}
          <g>
            <rect x={-1.0} y={-2.4} width={2} height={4.8} fill="#c9a36a" rx="0.3" />
            <polygon points="0,-2.6 -1.1,-1.6 1.1,-1.6" fill="#fff" opacity="0.7" />
          </g>
          {/* Tracks */}
          {tracks.map((tr) => {
            const rad = (tr.bearingDeg * Math.PI) / 180;
            const tx = Math.sin(rad) * tr.distanceM;
            const ty = -Math.cos(rad) * tr.distanceM;
            const colour =
              tr.cls === "pedestrian"
                ? "#e6553f"
                : tr.cls === "cyclist"
                  ? "#e8b54e"
                  : tr.cls === "vehicle"
                    ? "#6ca0d2"
                    : "#9aa3ad";
            return (
              <g key={tr.id}>
                <circle cx={tx} cy={ty} r={Math.max(0.7, 1.4 - tr.distanceM / 50)} fill={colour} />
                {tr.risk && tr.risk > 0.3 ? (
                  <circle cx={tx} cy={ty} r={2.4} fill="none" stroke={colour} strokeWidth={0.18} />
                ) : null}
              </g>
            );
          })}
        </svg>
        {tl ? (
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{
                background:
                  tl.state === "green"
                    ? "#3fc287"
                    : tl.state === "yellow"
                      ? "#e8b54e"
                      : tl.state === "red"
                        ? "#e6553f"
                        : "#9aa3ad",
                boxShadow: `0 0 12px ${
                  tl.state === "green"
                    ? "rgba(63,194,135,0.7)"
                    : tl.state === "yellow"
                      ? "rgba(232,181,78,0.7)"
                      : tl.state === "red"
                        ? "rgba(230,85,63,0.7)"
                        : "rgba(154,163,173,0.5)"
                }`,
              }}
            />
            <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              SPaT {tl.state} · ttc {tl.ttcS ?? "?"} s · conf {(tl.confidence ?? 0).toFixed(2)}
            </span>
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}

function DetectionsTile({ frame }: Props): React.JSX.Element {
  const d = frame.perception?.detections ?? {};
  const lg = frame.perception?.laneGraph;
  const fs = frame.perception?.freeSpaceRatio;
  const planner = frame.planner;
  return (
    <GlassPanel variant="muted" className="!p-5">
      <SpecLabel>Detections · classes</SpecLabel>
      <ul className="mt-4 grid grid-cols-2 gap-3 text-[length:var(--text-control)] text-pearl">
        <DetectionRow label="Vehicles" value={d.vehicles} />
        <DetectionRow label="Pedestrians" value={d.pedestrians} colour="#e6553f" />
        <DetectionRow label="Cyclists" value={d.cyclists} colour="#e8b54e" />
        <DetectionRow label="Two-wheelers" value={d.twoWheelers} />
        <DetectionRow label="Animals" value={d.animals} />
        <DetectionRow label="Signs" value={d.signs} />
        <DetectionRow label="Cones" value={d.cones} />
      </ul>
      {lg ? (
        <div className="mt-5 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          lane {lg.currentLane + 1}/{lg.totalLanes} · conf {lg.confidence.toFixed(2)} · free-space {(fs ?? 0).toFixed(2)}
        </div>
      ) : null}
      {planner ? (
        <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          planner · {planner.behavior?.toUpperCase()} · h {planner.horizonS}s · {planner.sampledTrajectories} alts ·
          cvar95 {(planner.cvar95 ?? 0).toFixed(3)}
        </div>
      ) : null}
    </GlassPanel>
  );
}

function DetectionRow({ label, value, colour }: { label: string; value: number | undefined; colour?: string }): React.JSX.Element {
  return (
    <li className="flex items-baseline justify-between">
      <span className="text-pearl-soft">{label}</span>
      <span className="luxe-mono tabular-nums text-pearl" style={colour ? { color: colour } : undefined}>
        {value ?? 0}
      </span>
    </li>
  );
}

function TracksTable({ tracks }: { tracks: NonNullable<TelemetryFrame["perception"]>["tracks"] }): React.JSX.Element {
  if (!tracks) return <></>;
  return (
    <GlassPanel variant="muted" className="!p-0 mt-6">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            <th className="px-5 py-3">ID</th>
            <th className="px-5 py-3">Class</th>
            <th className="px-5 py-3">Range</th>
            <th className="px-5 py-3">Bearing</th>
            <th className="px-5 py-3">Velocity</th>
            <th className="px-5 py-3">Horizon</th>
            <th className="px-5 py-3">Risk</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id} className="border-t border-[var(--color-hairline)] text-pearl">
              <td className="px-5 py-3 luxe-mono text-[length:var(--text-control)]">{t.id}</td>
              <td className="px-5 py-3 text-[length:var(--text-control)]">{t.cls}</td>
              <td className="px-5 py-3 luxe-mono tabular-nums text-[length:var(--text-control)]">{t.distanceM.toFixed(1)} m</td>
              <td className="px-5 py-3 luxe-mono tabular-nums text-[length:var(--text-control)]">{t.bearingDeg.toFixed(1)}°</td>
              <td className="px-5 py-3 luxe-mono tabular-nums text-[length:var(--text-control)]">{t.vMps.toFixed(1)} m/s</td>
              <td className="px-5 py-3 luxe-mono tabular-nums text-[length:var(--text-control)]">{t.predictionHorizonS ?? "?"} s</td>
              <td className="px-5 py-3 luxe-mono tabular-nums text-[length:var(--text-control)]">
                <span
                  style={{
                    color:
                      (t.risk ?? 0) > 0.4
                        ? "#e6553f"
                        : (t.risk ?? 0) > 0.2
                          ? "#e8b54e"
                          : "#3fc287",
                  }}
                >
                  {(t.risk ?? 0).toFixed(2)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassPanel>
  );
}

// --- Section: localization -------------------------------------------------

function LocalizationSection({ frame }: Props): React.JSX.Element {
  const g = frame.gnss;
  const i = frame.imu;
  if (!g && !i) return <></>;
  return (
    <Section title="Localization" eyebrow="GNSS · IMU · VIO/LIO">
      <div className="grid gap-6 md:grid-cols-2">
        {g ? (
          <GlassPanel variant="muted" className="!p-5">
            <SpecLabel>GNSS · multi-constellation</SpecLabel>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
              <Row label="Fix" value={g.fix.toUpperCase()} accent={g.fix.startsWith("rtk") ? "ok" : "warn"} />
              <Row label="Sats" value={String(g.satellites)} />
              <Row label="HDOP" value={g.hdop.toFixed(2)} />
              <Row label="PDOP" value={g.pdop?.toFixed(2)} />
              <Row label="RTK age" value={g.rtkAgeS !== undefined ? `${g.rtkAgeS.toFixed(1)} s` : undefined} />
              <Row label="Pos σ" value={g.posAccuracyM !== undefined ? `${(g.posAccuracyM * 100).toFixed(1)} cm` : undefined} />
            </dl>
            {g.constellations ? (
              <div className="mt-4 grid grid-cols-3 gap-3 text-pearl-soft">
                {Object.entries(g.constellations).map(([k, v]) => (
                  <div key={k} className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)]">
                    {k} {v}
                  </div>
                ))}
              </div>
            ) : null}
          </GlassPanel>
        ) : null}
        {i ? (
          <GlassPanel variant="muted" className="!p-5">
            <SpecLabel>IMU · 9-DoF</SpecLabel>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
              <Row label="Accel x" value={`${i.accel.x.toFixed(2)} m/s²`} />
              <Row label="Accel y" value={`${i.accel.y.toFixed(2)} m/s²`} />
              <Row label="Accel z" value={`${i.accel.z.toFixed(2)} m/s²`} />
              <Row label="Gyro z" value={`${i.gyro.z.toFixed(3)} rad/s`} />
              <Row label="IMU temp" value={i.tempC !== undefined ? `${i.tempC.toFixed(1)} °C` : undefined} />
              <Row label="Bias inst." value={i.biasInstabilityDegHr !== undefined ? `${i.biasInstabilityDegHr.toFixed(2)} °/h` : undefined} />
            </dl>
          </GlassPanel>
        ) : null}
      </div>
    </Section>
  );
}

// --- Section: dynamics -----------------------------------------------------

function DynamicsSection({ frame }: Props): React.JSX.Element {
  const w = frame.wheels;
  const c = frame.chassis;
  if (!w && !c) return <></>;
  return (
    <Section title="Vehicle dynamics" eyebrow="Wheels · steering · chassis">
      <div className="grid gap-6 md:grid-cols-2">
        {w ? (
          <GlassPanel variant="muted" className="!p-5">
            <SpecLabel>Wheels · per corner</SpecLabel>
            <div className="mt-4 grid grid-cols-2 gap-3 text-[length:var(--text-control)] text-pearl">
              <CornerTile label="FL" rpm={w.rpm.fl} kpa={w.tpmsKpa.fl} hubC={w.hubTempC?.fl} tyreC={w.tpmsTempC?.fl} />
              <CornerTile label="FR" rpm={w.rpm.fr} kpa={w.tpmsKpa.fr} hubC={w.hubTempC?.fr} tyreC={w.tpmsTempC?.fr} />
              <CornerTile label="RL" rpm={w.rpm.rl} kpa={w.tpmsKpa.rl} hubC={w.hubTempC?.rl} tyreC={w.tpmsTempC?.rl} />
              <CornerTile label="RR" rpm={w.rpm.rr} kpa={w.tpmsKpa.rr} hubC={w.hubTempC?.rr} tyreC={w.tpmsTempC?.rr} />
            </div>
          </GlassPanel>
        ) : null}
        {c ? (
          <GlassPanel variant="muted" className="!p-5">
            <SpecLabel>Steering · brakes · suspension</SpecLabel>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
              <Row label="Steering ang." value={`${c.steeringAngleDeg.toFixed(1)}°`} />
              <Row label="Steering torque" value={c.steeringTorqueNm !== undefined ? `${c.steeringTorqueNm.toFixed(2)} Nm` : undefined} />
              <Row label="Brake p. (front)" value={c.brakePressureBar?.front !== undefined ? `${c.brakePressureBar.front.toFixed(0)} bar` : undefined} />
              <Row label="Brake p. (rear)" value={c.brakePressureBar?.rear !== undefined ? `${c.brakePressureBar.rear.toFixed(0)} bar` : undefined} />
              <Row label="Friction est." value={c.frictionCoef !== undefined ? c.frictionCoef.toFixed(2) : undefined} />
              <Row label="Ride h. (avg)" value={c.rideHeightMm ? `${avg4(c.rideHeightMm).toFixed(0)} mm` : undefined} />
            </dl>
          </GlassPanel>
        ) : null}
      </div>
    </Section>
  );
}

function CornerTile({ label, rpm, kpa, hubC, tyreC }: { label: string; rpm: number; kpa: number; hubC: number | undefined; tyreC: number | undefined }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] p-3">
      <div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        {label}
      </div>
      <div className="mt-2 luxe-mono tabular-nums text-[length:var(--text-control)] text-pearl">
        {rpm.toFixed(0)} rpm
      </div>
      <div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        {kpa.toFixed(0)} kPa
        {hubC !== undefined ? ` · hub ${hubC.toFixed(0)} °C` : ""}
        {tyreC !== undefined ? ` · tyre ${tyreC.toFixed(0)} °C` : ""}
      </div>
    </div>
  );
}

// --- Section: powertrain ---------------------------------------------------

function PowertrainSection({ frame }: Props): React.JSX.Element {
  const p = frame.powertrain;
  if (!p) return <></>;
  return (
    <Section title="Powertrain" eyebrow="Motors · inverter · HV pack">
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Motors · inverter · bus</SpecLabel>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
            <Row label="Front τ" value={p.motorFront ? `${p.motorFront.torqueNm.toFixed(0)} Nm` : undefined} />
            <Row label="Front stator" value={p.motorFront ? `${p.motorFront.tempStatorC.toFixed(1)} °C` : undefined} />
            <Row label="Rear τ" value={p.motorRear ? `${p.motorRear.torqueNm.toFixed(0)} Nm` : undefined} />
            <Row label="Rear stator" value={p.motorRear ? `${p.motorRear.tempStatorC.toFixed(1)} °C` : undefined} />
            <Row label="Inverter" value={p.inverterTempC !== undefined ? `${p.inverterTempC.toFixed(1)} °C` : undefined} />
            <Row label="Inverter I" value={p.inverterCurrentA !== undefined ? `${p.inverterCurrentA.toFixed(0)} A` : undefined} />
            <Row label="HV bus V" value={p.hvBusV !== undefined ? `${p.hvBusV.toFixed(1)} V` : undefined} />
            <Row label="HV bus A" value={p.hvBusA !== undefined ? `${p.hvBusA.toFixed(0)} A` : undefined} />
            <Row label="12V aux" value={p.aux12vV !== undefined ? `${p.aux12vV.toFixed(2)} V` : undefined} />
            <Row label="Isolation" value={p.hvIsolationKohm !== undefined ? `${p.hvIsolationKohm} kΩ` : undefined} accent={p.hvIsolationKohm !== undefined && p.hvIsolationKohm < 500 ? "warn" : "ok"} />
            <Row label="SoH" value={p.hvSohPercent !== undefined ? `${p.hvSohPercent.toFixed(1)} %` : undefined} />
            <Row label="SoP" value={p.hvSopKw !== undefined ? `${p.hvSopKw.toFixed(0)} kW` : undefined} />
            <Row label="Coolant motor" value={p.coolantMotorC !== undefined ? `${p.coolantMotorC.toFixed(1)} °C` : undefined} />
            <Row label="Coolant batt." value={p.coolantBatteryC !== undefined ? `${p.coolantBatteryC.toFixed(1)} °C` : undefined} />
          </dl>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <div className="flex items-baseline justify-between">
            <SpecLabel>HV pack · cells</SpecLabel>
            <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              {p.hvCellsMv?.length ?? 0} cells · spread{" "}
              {p.hvCellsMv && p.hvCellsMv.length > 0
                ? `${(Math.max(...p.hvCellsMv) - Math.min(...p.hvCellsMv)).toFixed(0)} mV`
                : "—"}
            </span>
          </div>
          <CellHeatmap mv={p.hvCellsMv ?? []} tempC={p.hvCellsTempC ?? []} />
        </GlassPanel>
      </div>
    </Section>
  );
}

function CellHeatmap({ mv, tempC }: { mv: number[]; tempC: number[] }): React.JSX.Element {
  if (mv.length === 0) {
    return (
      <div className="mt-4 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        no cell stream
      </div>
    );
  }
  const min = Math.min(...mv);
  const max = Math.max(...mv);
  const span = Math.max(1, max - min);
  return (
    <div className="mt-4">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
        {mv.map((v, i) => {
          const t = (v - min) / span; // 0..1
          const colour = t < 0.18 ? "#e6553f" : t < 0.4 ? "#e8b54e" : "#3fc287";
          return (
            <div
              key={i}
              title={`cell ${i + 1}: ${v} mV${tempC[i] !== undefined ? ` · ${tempC[i]} °C` : ""}`}
              className="aspect-square rounded-[2px]"
              style={{ background: colour, opacity: 0.55 + t * 0.45 } as CSSProperties}
            />
          );
        })}
      </div>
      <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        min {min} mV · max {max} mV · mean{" "}
        {Math.round(mv.reduce((s, v) => s + v, 0) / mv.length)} mV
      </div>
    </div>
  );
}

// --- Section: compute ------------------------------------------------------

function ComputeSection({ frame }: Props): React.JSX.Element {
  const c = frame.compute;
  if (!c) return <></>;
  return (
    <Section title="AI compute · lockstep · HSM" eyebrow="On-vehicle silicon">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Primary AI compute</SpecLabel>
          <div className="mt-2 text-[length:var(--text-control)] text-pearl">{c.primary?.soc ?? "—"}</div>
          <Bars
            entries={[
              { label: "CPU", v: c.primary?.cpuPct },
              { label: "GPU", v: c.primary?.gpuPct },
              { label: "NPU", v: c.primary?.npuPct },
              { label: "RAM", v: c.primary?.ramPct },
            ]}
          />
          <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {c.primary?.tempC !== undefined ? `${c.primary.tempC.toFixed(1)} °C` : ""}
            {c.primary?.powerW !== undefined ? ` · ${c.primary.powerW.toFixed(0)} W` : ""}
          </div>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Lockstep ECU · ASIL-D</SpecLabel>
          <div className="mt-2 text-[length:var(--text-control)] text-pearl">{c.lockstep?.soc ?? "—"}</div>
          <Bars
            entries={[
              { label: "CPU", v: c.lockstep?.cpuPct },
              { label: "Diff (ppm)", v: (c.lockstep?.diffPpm ?? 0) / 100 },
            ]}
          />
          <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {c.lockstep?.tempC !== undefined ? `${c.lockstep.tempC.toFixed(1)} °C` : ""}
          </div>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>HSM · TPM · keys</SpecLabel>
          <div className="mt-3">
            <StatusPill tone={c.hsmHeartbeatOk ? "ok" : "halt"} size="sm">
              {c.hsmHeartbeatOk ? "HEARTBEAT OK" : "HSM SILENT"}
            </StatusPill>
          </div>
          <div className="mt-3 text-[length:var(--text-control)] text-pearl-soft">
            ML-DSA witness keys verified at boot. PQ-hybrid TLS to MEC. Recall flags clean.
          </div>
        </GlassPanel>
      </div>
    </Section>
  );
}

function Bars({ entries }: { entries: Array<{ label: string; v: number | undefined }> }): React.JSX.Element {
  return (
    <ul className="mt-4 space-y-2">
      {entries.map((e) => (
        <li key={e.label}>
          <div className="flex justify-between text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft luxe-mono">
            <span>{e.label}</span>
            <span>{e.v !== undefined ? `${e.v.toFixed(0)}%` : "—"}</span>
          </div>
          <div className="mt-1 h-[3px] w-full rounded-full bg-[var(--color-hairline)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, e.v ?? 0))}%`,
                background:
                  (e.v ?? 0) > 90
                    ? "#e6553f"
                    : (e.v ?? 0) > 75
                      ? "#e8b54e"
                      : "#6ca0d2",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Section: network ------------------------------------------------------

function NetworkSection({ frame }: Props): React.JSX.Element {
  const n = frame.network;
  if (!n) return <></>;
  return (
    <Section title="Network · MEC · HD-map" eyebrow="5G NR-V2X · OTA">
      <GlassPanel variant="muted" className="!p-5">
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
          <Row label="Cell RSRP" value={n.rsrpDbm !== undefined ? `${n.rsrpDbm} dBm` : undefined} />
          <Row label="Cell RSRQ" value={n.rsrqDb !== undefined ? `${n.rsrqDb} dB` : undefined} />
          <Row label="Cell SINR" value={n.sinrDb !== undefined ? `${n.sinrDb} dB` : undefined} />
          <Row label="MEC RTT" value={n.mecRttMs !== undefined ? `${n.mecRttMs.toFixed(1)} ms` : undefined} />
          <Row label="Wi-Fi 6E" value={n.wifiRssiDbm !== undefined ? `${n.wifiRssiDbm} dBm` : undefined} />
          <Row label="HD-map δ" value={n.hdMapDeltasPending !== undefined ? `${n.hdMapDeltasPending} pending` : undefined} />
        </dl>
        <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          {n.hdMapVersion ? `vector-map ${n.hdMapVersion}` : ""}
          {n.hdMapSyncedAt ? ` · synced ${shortAge(n.hdMapSyncedAt)}` : ""}
        </div>
      </GlassPanel>
    </Section>
  );
}

// --- Section: V2X ----------------------------------------------------------

function V2xSection({ frame }: Props): React.JSX.Element {
  const v = frame.v2x;
  if (!v) return <></>;
  return (
    <Section title="V2X bus · PC5 sidelink" eyebrow="C-V2X · 5G NR-V2X">
      <GlassPanel variant="muted" className="!p-5">
        <dl className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
          <Row label="BSM rx/s" value={fmtN(v.bsmRxPerSec)} />
          <Row label="CAM rx/s" value={fmtN(v.camRxPerSec)} />
          <Row label="SPaT rx/s" value={fmtN(v.spatRxPerSec)} />
          <Row label="MAP rx/s" value={fmtN(v.mapRxPerSec)} />
          <Row label="DENM rx/s" value={fmtN(v.denmRxPerSec)} />
          <Row label="RSA rx/s" value={fmtN(v.rsaRxPerSec)} />
          <Row label="Neighbours" value={v.neighbours !== undefined ? `${v.neighbours}` : undefined} />
          <Row label="Latest" value={v.latestKind} />
        </dl>
        {v.latestSummary ? (
          <div className="mt-3 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft truncate">
            {v.latestSummary}
          </div>
        ) : null}
      </GlassPanel>
    </Section>
  );
}

// --- Section: safety / SOTIF -----------------------------------------------

function SafetySection({ frame }: Props): React.JSX.Element {
  const s = frame.safety;
  if (!s) return <></>;
  const oodPct = s.oodMahalanobis !== undefined && s.oodThreshold ? Math.min(1, s.oodMahalanobis / s.oodThreshold) : 0;
  return (
    <Section title="Safety · SOTIF · UNECE R157" eyebrow="ODD · OOD · capability">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>ODD compliance</SpecLabel>
          <div className="mt-3">
            <StatusPill tone={s.oddCompliant === false ? "halt" : "ok"} size="sm">
              {s.oddCompliant === false ? "OUT OF ODD" : "INSIDE ODD"}
            </StatusPill>
          </div>
          <div className="mt-3 text-[length:var(--text-control)] text-pearl-soft">
            {s.oddReason ?? "Geofence, weather, time-of-day, road class all inside policy."}
          </div>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>OOD detector · Mahalanobis</SpecLabel>
          <div className="mt-2 luxe-mono text-[length:var(--text-h3)] text-pearl">
            {(s.oodMahalanobis ?? 0).toFixed(2)}
            <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft pl-3">
              / {(s.oodThreshold ?? 0).toFixed(2)}
            </span>
          </div>
          <div className="mt-3 h-[3px] w-full rounded-full bg-[var(--color-hairline)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(oodPct * 100)}%`,
                background: oodPct > 0.85 ? "#e6553f" : oodPct > 0.6 ? "#e8b54e" : "#3fc287",
              }}
            />
          </div>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>R157 takeover · MRM</SpecLabel>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
            <Row label="Rung" value={String(s.takeoverRung ?? 0)} />
            <Row label="TTC" value={s.ttcSec !== undefined ? `${s.ttcSec.toFixed(1)} s` : undefined} />
            <Row label="FTTI" value={s.fttiMs !== undefined ? `${s.fttiMs} ms` : undefined} />
            <Row label="Capability" value={s.capabilityBudget !== undefined ? `${(s.capabilityBudget * 100).toFixed(0)} %` : undefined} />
            <Row label="MRM" value={s.mrmActive ? (s.mrmKind ?? "active") : "armed"} />
          </dl>
        </GlassPanel>
      </div>
    </Section>
  );
}

// --- Section: cabin --------------------------------------------------------

function CabinSection({ frame }: Props): React.JSX.Element {
  const c = frame.cabin;
  if (!c) return <></>;
  const att = c.driverAttention;
  return (
    <Section title="Cabin · driver · air quality" eyebrow="DMS · OMS · HVAC">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Driver-monitoring</SpecLabel>
          {att ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
              <Row label="Gaze on road" value={`${(att.gazeOnRoad * 100).toFixed(0)} %`} />
              <Row label="Eyes closed" value={att.eyesClosed ? "yes" : "no"} accent={att.eyesClosed ? "warn" : "ok"} />
              <Row label="Hands on wheel" value={att.handsOnWheel ? "yes" : "no"} accent={att.handsOnWheel === false ? "warn" : "ok"} />
              <Row label="Seat belt" value={att.seatBelt ? "buckled" : "off"} accent={att.seatBelt === false ? "warn" : "ok"} />
            </dl>
          ) : (
            <div className="mt-3 text-[length:var(--text-control)] text-pearl-soft">No DMS feed.</div>
          )}
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Cabin air</SpecLabel>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
            <Row label="Temp" value={c.cabinTempC !== undefined ? `${c.cabinTempC.toFixed(1)} °C` : undefined} />
            <Row label="RH" value={c.cabinHumidityPct !== undefined ? `${c.cabinHumidityPct.toFixed(0)} %` : undefined} />
            <Row label="CO₂" value={c.co2Ppm !== undefined ? `${c.co2Ppm} ppm` : undefined} accent={c.co2Ppm !== undefined && c.co2Ppm > 1500 ? "warn" : "ok"} />
            <Row label="PM2.5" value={c.pm25Ugm3 !== undefined ? `${c.pm25Ugm3.toFixed(1)} µg/m³` : undefined} />
          </dl>
        </GlassPanel>
        <GlassPanel variant="muted" className="!p-5">
          <SpecLabel>Occupancy · OMS</SpecLabel>
          <div className="mt-3 luxe-mono text-[length:var(--text-h3)] text-pearl">
            {c.occupants ?? 0}
            <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft pl-3">
              occupants
            </span>
          </div>
        </GlassPanel>
      </div>
    </Section>
  );
}

// --- Section: environment --------------------------------------------------

function EnvironmentSection({ frame }: Props): React.JSX.Element {
  const e = frame.environment;
  if (!e) return <></>;
  return (
    <Section title="Environment" eyebrow="Weather · pavement · time-of-day">
      <GlassPanel variant="muted" className="!p-5">
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-2 text-[length:var(--text-control)] text-pearl">
          <Row label="Weather" value={e.weather} />
          <Row label="Visibility" value={e.visibilityM !== undefined ? `${e.visibilityM.toLocaleString()} m` : undefined} />
          <Row label="Ambient" value={e.ambientTempC !== undefined ? `${e.ambientTempC.toFixed(1)} °C` : undefined} />
          <Row label="Humidity" value={e.ambientHumidityPct !== undefined ? `${e.ambientHumidityPct.toFixed(0)} %` : undefined} />
          <Row label="Wind" value={e.windKph !== undefined ? `${e.windKph.toFixed(0)} kph` : undefined} />
          <Row label="Pavement" value={e.pavement} />
          <Row label="Time" value={e.timeOfDay} />
        </dl>
      </GlassPanel>
    </Section>
  );
}

// --- Section: software footer ---------------------------------------------

function SoftwareFooter({ frame }: Props): React.JSX.Element {
  const s = frame.software;
  if (!s) return <></>;
  return (
    <div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
      {[
        s.perceptionVersion ? `perception ${s.perceptionVersion}` : null,
        s.plannerVersion ? `planner ${s.plannerVersion}` : null,
        s.controlVersion ? `control ${s.controlVersion}` : null,
        s.osVersion ? `os ${s.osVersion}` : null,
        s.calibrationVersion ? `cal ${s.calibrationVersion}` : null,
        s.shadowModeUploadAt ? `shadow upload ${shortAge(s.shadowModeUploadAt)}` : null,
      ]
        .filter(Boolean)
        .join("  ·  ")}
    </div>
  );
}

// --- Layout helpers --------------------------------------------------------

function Section({
  title,
  eyebrow,
  right,
  children,
}: {
  title: string;
  eyebrow?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col">
          {eyebrow ? <SpecLabel>{eyebrow}</SpecLabel> : null}
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] text-pearl">
            {title}
          </h2>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number | undefined;
  accent?: "ok" | "warn";
}): React.JSX.Element {
  if (value === undefined || value === null || value === "") {
    return (
      <>
        <dt className="text-pearl-soft">{label}</dt>
        <dd className="luxe-mono tabular-nums text-pearl-soft">—</dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-pearl-soft">{label}</dt>
      <dd
        className="luxe-mono tabular-nums"
        style={{
          color: accent === "warn" ? "#e8b54e" : accent === "ok" ? "#3fc287" : "var(--color-pearl)",
        }}
      >
        {value}
      </dd>
    </>
  );
}

function avg4(o: { fl: number; fr: number; rl: number; rr: number }): number {
  return (o.fl + o.fr + o.rl + o.rr) / 4;
}

function fmtN(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  return n.toFixed(1);
}

function shortAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
