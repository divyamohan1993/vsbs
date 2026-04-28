// =============================================================================
// 72-hour breach reporter (DPDP Rule 7, GDPR Art. 33).
//
// Engine for the runbook in docs/compliance/breach-runbook.md. Tracks
// incidents, computes the SLA clock, holds notification drafts, and
// supports principal notification under DPDP s.8(6) and GDPR Art. 34.
//
// Sim driver writes notifications to an in-memory queue. Live driver POSTs
// to the Data Protection Board portal and the lead supervisory authority.
// =============================================================================

import { z } from "zod";

import { uuidv7 } from "./uuidv7.js";
import { evidenceHash } from "./hash.js";

export const SeveritySchema = z.enum(["SEV-1", "SEV-2", "SEV-3"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const BreachCategorySchema = z.enum([
  "confidentiality",
  "integrity",
  "availability",
]);
export type BreachCategory = z.infer<typeof BreachCategorySchema>;

export const NotifyChannelSchema = z.enum([
  "dpb-india",
  "edpb-supervisory",
  "principals-email",
  "principals-sms",
  "principals-inapp",
]);
export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const NotificationStatusSchema = z.enum(["pending", "sent", "failed"]);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const TimelineEventSchema = z.object({
  at: z.string().datetime(),
  kind: z.enum([
    "detected",
    "ic-engaged",
    "contained",
    "evidence-frozen",
    "scope-assessed",
    "draft-prepared",
    "dpb-notified",
    "supervisory-notified",
    "principals-notified",
    "post-mortem",
    "closed",
  ]),
  detail: z.string().max(2000).optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  channel: NotifyChannelSchema,
  recipientHint: z.string().max(200),
  bodyHash: z.string().length(64),
  status: NotificationStatusSchema,
  queuedAt: z.string().datetime(),
  sentAt: z.string().datetime().optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  severity: SeveritySchema,
  category: BreachCategorySchema,
  scope: z.object({
    principals: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
    jurisdictions: z.array(z.string()).default([]),
    dataCategories: z.array(z.string()).default([]),
  }),
  description: z.string().min(8).max(4000),
  detectedAt: z.string().datetime(),
  slaDeadline: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
  timeline: z.array(TimelineEventSchema).default([]),
  notifications: z.array(NotificationSchema).default([]),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const SLA_HOURS = 72;

export interface BreachReporter {
  recordIncident(input: {
    severity: Severity;
    category: BreachCategory;
    scope: Incident["scope"];
    description: string;
    detectedAt?: string;
  }): Promise<Incident>;
  notifyDPB(incidentId: string, body: string): Promise<Notification>;
  notifySupervisory(incidentId: string, body: string): Promise<Notification>;
  notifyDataPrincipals(incidentId: string, userIds: string[], body: string): Promise<Notification[]>;
  appendEvent(incidentId: string, ev: Omit<TimelineEvent, "at"> & { at?: string }): Promise<Incident>;
  getIncidentTimeline(incidentId: string): Promise<TimelineEvent[]>;
  hoursRemaining(incidentId: string, now?: number): Promise<number>;
  isOverdue(incidentId: string, now?: number): Promise<boolean>;
  getIncident(incidentId: string): Promise<Incident | undefined>;
  list(): Promise<Incident[]>;
  close(incidentId: string): Promise<Incident>;
}

export class StandardBreachReporter implements BreachReporter {
  readonly #incidents = new Map<string, Incident>();

  async recordIncident(input: {
    severity: Severity;
    category: BreachCategory;
    scope: Incident["scope"];
    description: string;
    detectedAt?: string;
  }): Promise<Incident> {
    const detectedAt = input.detectedAt ?? new Date().toISOString();
    const sla = new Date(new Date(detectedAt).getTime() + SLA_HOURS * 3600_000).toISOString();
    const id = uuidv7();
    const incident: Incident = IncidentSchema.parse({
      id,
      severity: input.severity,
      category: input.category,
      scope: input.scope,
      description: input.description,
      detectedAt,
      slaDeadline: sla,
      timeline: [{ at: detectedAt, kind: "detected", detail: input.description.slice(0, 200) }],
      notifications: [],
    });
    this.#incidents.set(id, incident);
    return incident;
  }

  async notifyDPB(incidentId: string, body: string): Promise<Notification> {
    return this.#notify(incidentId, "dpb-india", "Data Protection Board of India", body, "dpb-notified");
  }

  async notifySupervisory(incidentId: string, body: string): Promise<Notification> {
    return this.#notify(
      incidentId,
      "edpb-supervisory",
      "Lead supervisory authority (EU)",
      body,
      "supervisory-notified",
    );
  }

  async notifyDataPrincipals(
    incidentId: string,
    userIds: string[],
    body: string,
  ): Promise<Notification[]> {
    const out: Notification[] = [];
    for (const uid of userIds) {
      out.push(await this.#notify(incidentId, "principals-inapp", uid, body, "principals-notified"));
    }
    return out;
  }

  async appendEvent(
    incidentId: string,
    ev: Omit<TimelineEvent, "at"> & { at?: string },
  ): Promise<Incident> {
    const inc = this.#mustGet(incidentId);
    const event = TimelineEventSchema.parse({ at: ev.at ?? new Date().toISOString(), kind: ev.kind, ...(ev.detail !== undefined ? { detail: ev.detail } : {}) });
    inc.timeline = [...inc.timeline, event];
    this.#incidents.set(incidentId, inc);
    return inc;
  }

  async getIncidentTimeline(incidentId: string): Promise<TimelineEvent[]> {
    const inc = this.#mustGet(incidentId);
    return [...inc.timeline];
  }

  async hoursRemaining(incidentId: string, now: number = Date.now()): Promise<number> {
    const inc = this.#mustGet(incidentId);
    const deadline = new Date(inc.slaDeadline).getTime();
    return Math.max(0, (deadline - now) / 3600_000);
  }

  async isOverdue(incidentId: string, now: number = Date.now()): Promise<boolean> {
    const inc = this.#mustGet(incidentId);
    return new Date(inc.slaDeadline).getTime() <= now && !inc.notifications.some((n) => n.channel === "dpb-india" && n.status === "sent");
  }

  async getIncident(incidentId: string): Promise<Incident | undefined> {
    return this.#incidents.get(incidentId);
  }

  async list(): Promise<Incident[]> {
    return [...this.#incidents.values()];
  }

  async close(incidentId: string): Promise<Incident> {
    const inc = this.#mustGet(incidentId);
    inc.closedAt = new Date().toISOString();
    inc.timeline = [...inc.timeline, { at: inc.closedAt, kind: "closed" }];
    this.#incidents.set(incidentId, inc);
    return inc;
  }

  #mustGet(id: string): Incident {
    const inc = this.#incidents.get(id);
    if (!inc) throw new Error(`No incident ${id}`);
    return inc;
  }

  async #notify(
    incidentId: string,
    channel: NotifyChannel,
    recipientHint: string,
    body: string,
    timelineKind: TimelineEvent["kind"],
  ): Promise<Notification> {
    const inc = this.#mustGet(incidentId);
    const id = uuidv7();
    const notification: Notification = NotificationSchema.parse({
      id,
      channel,
      recipientHint: recipientHint.slice(0, 200),
      bodyHash: await evidenceHash({ incidentId, channel, recipientHint, body }),
      status: "sent",
      queuedAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
    });
    inc.notifications = [...inc.notifications, notification];
    inc.timeline = [...inc.timeline, { at: notification.sentAt!, kind: timelineKind, detail: recipientHint }];
    this.#incidents.set(incidentId, inc);
    return notification;
  }
}
