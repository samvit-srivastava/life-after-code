/**
 * The truth model. Turns a snapshot into what the scene and the UI may show.
 * Rules:
 *  - A stage is "done" only if the incident status says the loop passed it.
 *    It is "sourced" only if a matching timeline event backs it.
 *  - AI stages are never shown as proof, only as advisory.
 *  - "recovered" exists only when the incident record says RECOVERED.
 */
import { RECOVERY_PATH, TERMINAL_FAILURES, type IncidentDetail, type RecoveryAttempt, type RecoveryStage, type Snapshot, type TestResult, type TimelineEvent } from '../api/types';

export type SceneMode =
  | 'connecting' | 'offline' | 'healthy' | 'canary' | 'degraded'
  | 'breach' | 'contained' | 'investigating' | 'verifying' | 'redeploying' | 'recovered' | 'failed';

export type StageState = 'waiting' | 'active' | 'sourced' | 'unsourced' | 'advisory' | 'failed' | 'blocked' | 'confirmed';

export interface StageView {
  stage: RecoveryStage;
  n: number;
  label: string;
  verb: string;
  authority: string;
  ai: boolean;
  state: StageState;
  event?: TimelineEvent;
}

export const STAGES: Record<RecoveryStage, { label: string; verb: string; authority: string; events: string[]; ai?: boolean }> = {
  DETECTED: { label: 'Detect', verb: 'Regression detected', authority: 'Health evaluator job', events: ['incident.detected', 'evaluator.verdict'] },
  ROLLED_BACK: { label: 'Contain', verb: 'Rolled back', authority: 'Rollback job and post-rollback probe', events: ['rollback.completed'] },
  EVIDENCE_COLLECTED: { label: 'Evidence', verb: 'Evidence sealed', authority: 'Evidence job, SHA-256 sealed bundle', events: ['evidence.collected'] },
  INVESTIGATING: { label: 'Investigate', verb: 'AI investigating', authority: 'GitLab Duo flow (advisory)', events: ['flow.started'], ai: true },
  REPAIR_PROPOSED: { label: 'Propose', verb: 'Repair proposed', authority: 'GitLab Duo flow opens a merge request (advisory)', events: ['repair.proposed', 'flow.completed'], ai: true },
  VERIFYING: { label: 'Verify', verb: 'Gates verifying', authority: 'Regression-proof and Integrity Gate jobs', events: ['regression_proof.verdict', 'integrity_gate.verdict'] },
  MERGED: { label: 'Merge', verb: 'Merged', authority: 'GitLab, after every required job passes', events: ['merge.completed'] },
  REDEPLOYING: { label: 'Redeploy', verb: 'Redeploying', authority: 'Canary deploy job', events: ['deploy.canary_started', 'redeploy.completed'] },
  RECOVERED: { label: 'Recovered', verb: 'Recovery confirmed', authority: 'Post-redeploy health evaluator', events: ['recovery.verified'] },
};

const FAILURE_AT: Record<string, RecoveryStage> = {
  ROLLBACK_FAILED: 'ROLLED_BACK', INVESTIGATION_FAILED: 'INVESTIGATING', VERIFICATION_FAILED: 'VERIFYING', REDEPLOY_UNHEALTHY: 'REDEPLOYING',
};
export const FAILURE_COPY: Record<string, string> = {
  ROLLBACK_FAILED: 'Rollback failed', INVESTIGATION_FAILED: 'Investigation failed', VERIFICATION_FAILED: 'Verification failed',
  REDEPLOY_UNHEALTHY: 'Redeploy unhealthy', TIMED_OUT: 'Timed out', ESCALATED: 'Escalated to a person',
};

export const isFailure = (s: string) => (TERMINAL_FAILURES as readonly string[]).includes(s);

/** Events the backend accepted. Refused events stay in the ledger but never light a stage. */
export const accepted = (events: TimelineEvent[]) => events.filter((e) => !e.rejected);
const lastOf = (events: TimelineEvent[], types: string[]) => [...events].reverse().find((e) => !e.rejected && types.includes(e.type));

const stageOf = (type: string) => RECOVERY_PATH.findIndex((s) => STAGES[s].events.includes(type));
const failing = (e: TimelineEvent) => e.data?.verdict === 'FAIL' || e.data?.outcome === 'no_fix_found';

/** Where a failure without a fixed stage (ESCALATED, TIMED_OUT) stopped, read from the recorded events. */
function failurePoint(events: TimelineEvent[]): number {
  const last = [...events].reverse().find((e) => !e.rejected && stageOf(e.type) >= 0);
  if (!last) return 0;
  if (last.type === 'flow.completed' && last.data?.outcome === 'no_fix_found') return RECOVERY_PATH.indexOf('INVESTIGATING');
  const i = stageOf(last.type);
  return failing(last) ? i : Math.min(i + 1, RECOVERY_PATH.length - 1);
}

export function buildStages(status0: string | null, events: TimelineEvent[]): StageView[] {
  const status = status0 === 'OPEN' ? 'DETECTED' : status0;
  let at = status ? (RECOVERY_PATH as readonly string[]).indexOf(status) : -1;
  let failedAt = -1;
  if (status && isFailure(status)) {
    const f = FAILURE_AT[status];
    failedAt = f ? RECOVERY_PATH.indexOf(f) : failurePoint(events);
    at = failedAt;
  }
  const recovered = status === 'RECOVERED';
  return RECOVERY_PATH.map((stage, i) => {
    const m = STAGES[stage];
    const event = lastOf(events, m.events);
    let state: StageState;
    if (i === failedAt) state = 'failed';
    else if (failedAt >= 0 && i > failedAt) state = 'blocked';
    else if (recovered && stage === 'RECOVERED') state = 'confirmed';
    else if (at >= 0 && (i < at || recovered)) state = m.ai ? 'advisory' : event ? 'sourced' : 'unsourced';
    else if (i === at) state = m.ai ? 'advisory' : 'active';
    else state = 'waiting';
    return { stage, n: i + 1, label: m.label, verb: m.verb, authority: m.authority, ai: !!m.ai, state, event };
  });
}

/** The scene mood an incident status maps to. */
export function modeForStatus(s: string): SceneMode {
  if (isFailure(s)) return 'failed';
  return s === 'DETECTED' || s === 'OPEN' ? 'breach'
    : s === 'ROLLED_BACK' || s === 'EVIDENCE_COLLECTED' ? 'contained'
    : s === 'INVESTIGATING' || s === 'REPAIR_PROPOSED' ? 'investigating'
    : s === 'VERIFYING' || s === 'MERGED' ? 'verifying'
    : s === 'REDEPLOYING' ? 'redeploying'
    : s === 'RECOVERED' ? 'recovered' : 'breach';
}

export type Outcome = 'confirmed' | 'stopped' | 'pending';
export const outcomeOf = (s: string): Outcome => (s === 'RECOVERED' ? 'confirmed' : isFailure(s) ? 'stopped' : 'pending');

export interface IncidentView {
  stages: StageView[];
  attempt?: RecoveryAttempt;
  mode: SceneMode;
  progress: number;
  outcome: Outcome;
}

export function viewIncident(detail: IncidentDetail | null, status: string, events: TimelineEvent[], attemptNo?: number): IncidentView {
  const stages = buildStages(status, events);
  const atts = detail?.recovery_attempts ?? [];
  const attempt = attemptNo !== undefined ? atts.find((a) => a.attempt_no === attemptNo) : atts[atts.length - 1];
  const reached = stages.filter((s) => s.state !== 'waiting' && s.state !== 'blocked').length;
  return { stages, attempt, mode: modeForStatus(status), progress: reached / stages.length, outcome: outcomeOf(status) };
}

export interface Derived {
  mode: SceneMode;
  headline: string;
  sub: string;
  incident: IncidentDetail | null;
  incidentActive: boolean;
  attempt?: RecoveryAttempt;
  stages: StageView[];
  version: (releaseId: string) => string;
  /** 0..1 progress through the recovery loop, for the scene */
  progress: number;
}

export function derive(snap: Snapshot, connected: boolean | null, now: number): Derived {
  const st = snap.status;
  const byId = new Map<string, string>();
  snap.releases?.forEach((r) => byId.set(r.id, r.version));
  if (st?.current_release) byId.set(st.current_release.id, st.current_release.version);
  if (st?.candidate_release) byId.set(st.candidate_release.id, st.candidate_release.version);
  const version = (id: string) => byId.get(id) ?? id;

  const active = st?.active_incident ?? null;
  const focus = snap.focus && (!active || snap.focus.id === active.id) ? snap.focus : null;
  const incident: IncidentDetail | null = active ? { ...active, recovery_attempts: focus?.recovery_attempts ?? [] } : focus;
  const events = incident && snap.timeline ? snap.timeline : [];
  const stages = buildStages(incident?.status ?? null, events);
  const attempt = incident?.recovery_attempts[incident.recovery_attempts.length - 1];
  const reached = stages.filter((s) => s.state !== 'waiting' && s.state !== 'blocked').length;
  const progress = incident ? reached / stages.length : 0;

  if (!st) {
    return connected === false
      ? { mode: 'offline', headline: 'Sentinel cannot reach its API.', sub: 'Nothing below is live. Start the backend, or run the labelled demo scenario.', incident: null, incidentActive: false, stages: buildStages(null, []), version, progress: 0 }
      : { mode: 'connecting', headline: 'Establishing link.', sub: 'Waiting for the first reading from the Sentinel API.', incident: null, incidentActive: false, stages: buildStages(null, []), version, progress: 0 };
  }

  if (active) {
    const v = version(active.release_id);
    const s = active.status;
    if (isFailure(s)) return { mode: 'failed', headline: `Recovery stopped. ${FAILURE_COPY[s] ?? s}.`, sub: 'Sentinel halted the loop instead of shipping an unproven fix.', incident, incidentActive: true, attempt, stages, version, progress };
    const mode: SceneMode = s === 'DETECTED' ? 'breach'
      : s === 'ROLLED_BACK' || s === 'EVIDENCE_COLLECTED' ? 'contained'
      : s === 'INVESTIGATING' || s === 'REPAIR_PROPOSED' ? 'investigating'
      : s === 'VERIFYING' || s === 'MERGED' ? 'verifying'
      : s === 'REDEPLOYING' ? 'redeploying' : 'breach';
    const headline = {
      breach: `Release ${v} broke production.`,
      contained: `Contained. Rolled back from ${v}.`,
      investigating: 'AI is investigating. Gates will decide.',
      verifying: 'The fix is on trial.',
      redeploying: 'The proven fix is going out.',
    }[mode as 'breach'] ?? `Recovering from ${v}.`;
    const sub = {
      breach: 'The health evaluator recorded a regression. Containment has not been confirmed yet.',
      contained: 'Traffic is back on the last known-good release. Evidence is sealed for the investigation.',
      investigating: 'Everything the AI writes is advisory. Nothing it says counts as proof.',
      verifying: 'Regression proof, Integrity Gate and required CI jobs are deciding. Not the AI.',
      redeploying: 'The repaired release is moving through a canary. Recovery is not confirmed until the evaluator says so.',
    }[mode as 'breach'] ?? '';
    return { mode, headline, sub, incident, incidentActive: true, attempt, stages, version, progress };
  }

  if (incident?.status === 'RECOVERED') {
    const verified = lastOf(events, ['recovery.verified']);
    const t = verified ? Date.parse(verified.at) : NaN;
    if (Number.isFinite(t) && now - t < 120_000) {
      return { mode: 'recovered', headline: 'Recovered. Proven by production.', sub: `Incident ${incident.id} confirmed recovered by the post-redeploy health evaluator — not by the AI.`, incident, incidentActive: false, attempt, stages, version, progress: 1 };
    }
  }

  const h = st.system_health;
  const split = st.traffic_split;
  if (split && split.candidate_percent > 0 && st.candidate_release) {
    return { mode: 'canary', headline: `${st.candidate_release.version} is on trial.`, sub: `Taking ${split.candidate_percent}% of production traffic while the health evaluator watches.`, incident, incidentActive: false, attempt, stages, version, progress };
  }
  if (h && !h.healthy) {
    return { mode: 'degraded', headline: 'Health is outside its thresholds.', sub: 'The evaluator reports unhealthy, but no incident is open yet.', incident, incidentActive: false, attempt, stages, version, progress };
  }
  return {
    mode: 'healthy',
    headline: st.current_release ? `Holding steady on ${st.current_release.version}.` : 'No release reported yet.',
    sub: h ? 'Production is inside every threshold, according to the health evaluator.' : 'The API answered without a health reading.',
    incident, incidentActive: false, attempt, stages, version, progress,
  };
}

export interface ProofView { verdict: 'proven' | 'rejected' | 'pending' | 'partial'; reason: string; broken?: TestResult; fix?: TestResult; suite?: TestResult }

export function readProof(a?: RecoveryAttempt): ProofView {
  const last = (k: string) => [...(a?.test_results ?? [])].reverse().find((t) => t.kind === k);
  const broken = last('regression_on_broken'), fix = last('regression_on_fix'), suite = last('suite');
  // The backend may store the regression-proof job's own verdict instead of the two runs.
  const job = [...(a?.test_results ?? [])].reverse().find((t) => t.kind === 'regression_proof' || /^(PROVEN|REJECTED)$/i.test(t.outcome));
  if (job) {
    const ok = /^(PROVEN|PASS|PASSED)$/i.test(job.outcome);
    return ok
      ? { verdict: 'proven', reason: `The regression-proof job reported PROVEN${job.sha ? ` on ${job.sha.slice(0, 8)}` : ''}.`, suite }
      : { verdict: 'rejected', reason: `The regression-proof job rejected the test${job.failure_type ? `: ${job.failure_type}` : ''}.`, suite };
  }
  if (!broken && !fix) return { verdict: 'pending', reason: 'No regression-proof results recorded yet.', suite };
  if (!broken || !fix) return { verdict: 'partial', reason: 'Only one of the two required runs is recorded.', broken, fix, suite };
  if (broken.outcome !== 'FAILED') return { verdict: 'rejected', reason: 'The new test did not fail on the broken release, so it does not catch the bug.', broken, fix, suite };
  if (!/assert/i.test(broken.failure_type ?? '')) return { verdict: 'rejected', reason: `It failed with ${broken.failure_type ?? 'an unreported error'}, not an assertion. A crash is not proof.`, broken, fix, suite };
  if (fix.outcome !== 'PASSED') return { verdict: 'rejected', reason: 'The test does not pass on the fix.', broken, fix, suite };
  return { verdict: 'proven', reason: 'Fails on the broken release with an assertion. Passes on the fix.', broken, fix, suite };
}

export const MODE_COLOR: Record<SceneMode, string> = {
  connecting: '#6d7cff', offline: '#5d6470', healthy: '#3cf0ff', canary: '#ffc23d', degraded: '#ff8a3d',
  breach: '#ff2e63', contained: '#ff8a3d', investigating: '#a77bff', verifying: '#3cf0ff', redeploying: '#7dffb2',
  recovered: '#2bff88', failed: '#ff2e63',
};
