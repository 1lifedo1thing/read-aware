import { causalActor, stampEventCause, type DomainActor } from "./domain-actor";
import { invoke } from "./ipc";

/** Host-only report. Samples can contain entire records and must not cross actor APIs. */
export type ProjectionReport = {
  consistent: boolean;
  eventsReplayed: number;
  drift: { table: string; onlyLive: number; onlyReplayed: number; samples: string[] }[];
};

let active: Promise<ProjectionReport> | undefined;

/** Native replay must finish its rollback, even when every caller stops waiting. */
export function verifyProjectionReport(origin: DomainActor = "user"): Promise<ProjectionReport> {
  if (!active) {
    origin = causalActor(origin);
    active = invoke<ProjectionReport>("verify_projections").then(report => stampEventCause(report, origin)).finally(() => { active = undefined; });
  }
  return active;
}
