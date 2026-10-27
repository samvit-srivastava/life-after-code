import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getJSON } from './client';
import { demoSnapshot } from './demo';
import { toHealthz, toIncidentDetail, toIncidents, toReleases, toStatus, toTimeline } from './normalize';
import type { EndpointState, IncidentDetail, Snapshot, TimelineEvent } from './types';

export type SourceKind = 'live' | 'demo';
export interface Reading { t: number; err: number; p95: number; healthy: boolean }

interface SentinelCtx {
  source: SourceKind;
  snap: Snapshot;
  /** null while the first live request is in flight */
  connected: boolean | null;
  lastOkAt: number | null;
  error: string | null;
  stale: boolean;
  readings: Reading[];
  endpoints: Record<string, EndpointState>;
  demoFail: boolean;
  demoPhase: number;
  startDemo: (fail?: boolean) => void;
  exitDemo: () => void;
  /** Ask for one incident to be polled closely (the incident room). */
  watch: (id: string | null) => void;
}

const EMPTY: Snapshot = { status: null, releases: null, incidents: null, healthz: null, focus: null, timeline: null, details: {}, timelines: {}, events: [] };
const Ctx = createContext<SentinelCtx | null>(null);
const STEP_MS = Math.max(2, Number(new URLSearchParams(location.search).get('step') ?? 6)) * 1000;

export function useSentinel(): SentinelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSentinel outside SentinelProvider');
  return c;
}

/** Merge per-incident timelines into one ledger, oldest first, de-duplicated by id. */
function mergeEvents(timelines: Record<string, TimelineEvent[]>): TimelineEvent[] {
  const m = new Map<string, TimelineEvent>();
  Object.values(timelines).forEach((tl) => tl.forEach((e) => m.set(e.id, e)));
  return [...m.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The backend skeleton's timeline endpoint currently returns every incident.detected
 * event, whatever the incident. Keep only events that belong to this incident (or say nothing).
 */
const own = (id: string, tl: TimelineEvent[]) => tl.filter((e) => !e.incident_id || e.incident_id === id);

export function SentinelProvider({ children }: { children: ReactNode }) {
  const q = new URLSearchParams(location.search);
  const [source, setSource] = useState<SourceKind>(q.has('demo') ? 'demo' : 'live');
  const [demo, setDemo] = useState({ t0: Date.now(), fail: q.get('demo') === 'fail' });
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [endpoints, setEndpoints] = useState<Record<string, EndpointState>>({});
  const [now, setNow] = useState(Date.now());
  const [demoPhase, setDemoPhase] = useState(0);
  const [watched, setWatched] = useState<string | null>(null);
  const watchedRef = useRef<string | null>(null);
  watchedRef.current = watched;

  const push = useCallback((r: Reading) => setReadings((rs) => [...rs.filter((x) => r.t - x.t < 5 * 60_000), r]), []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- Demo source: recomputed from the clock; never touches the network.
  useEffect(() => {
    if (source !== 'demo') return;
    setReadings([]);
    setEndpoints({});
    setConnected(true);
    setError(null);
    let lastPush = 0;
    const tick = () => {
      const t = Date.now();
      const s = demoSnapshot(demo.t0, t, STEP_MS, demo.fail);
      setSnap(s);
      setDemoPhase(s.phase);
      setLastOkAt(t);
      const h = s.status?.system_health;
      if (h && t - lastPush > 900) { lastPush = t; push({ t, err: h.error_rate, p95: h.p95_ms, healthy: h.healthy }); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [source, demo, push]);

  // ---- Live source: polls the read API. Failed polls keep the last answer and mark it stale.
  useEffect(() => {
    if (source !== 'live') return;
    setSnap(EMPTY);
    setReadings([]);
    setConnected(null);
    const ctrl = new AbortController();
    let alive = true;
    let focusId: string | null = null;

    /** getJSON that records how each endpoint is doing, for the System page. */
    const hit = async (key: string, path: string) => {
      const t = performance.now();
      try {
        const v = await getJSON(path, ctrl.signal);
        if (alive) setEndpoints((e) => ({ ...e, [key]: { path, ok: true, at: Date.now(), ms: Math.round(performance.now() - t) } }));
        return v;
      } catch (err) {
        if (alive) setEndpoints((e) => ({ ...e, [key]: { path, ok: false, at: Date.now(), ms: null, error: (err as Error).message } }));
        throw err;
      }
    };

    const pollStatus = async () => {
      try {
        const st = toStatus(await hit('status', '/api/v1/status'));
        if (!alive) return;
        const t = Date.now();
        setSnap((s) => ({ ...s, status: st }));
        setConnected(true); setLastOkAt(t); setError(null);
        if (st.system_health) push({ t, err: st.system_health.error_rate, p95: st.system_health.p95_ms, healthy: st.system_health.healthy });
        if (st.active_incident) focusId = st.active_incident.id;
      } catch (e) {
        if (!alive) return;
        setConnected((c) => (c === null ? false : c));
        setError((e as Error).message);
      }
    };
    const pollHealthz = async () => {
      try { const h = toHealthz(await hit('healthz', '/api/v1/healthz')); if (alive) setSnap((s) => ({ ...s, healthz: h })); } catch { /* recorded in endpoints */ }
      try { await hit('storage', '/api/v1/state/storage'); } catch { /* recorded in endpoints */ }
      try { await hit('sre_health', '/api/v1/sre/health'); } catch { /* recorded in endpoints */ }
      try { await hit('sre_opa', '/api/v1/sre/opa'); } catch { /* recorded in endpoints */ }
      try { await hit('sre_ebpf', '/api/v1/sre/ebpf'); } catch { /* recorded in endpoints */ }
      try { await hit('sre_dr', '/api/v1/sre/dr'); } catch { /* recorded in endpoints */ }
      try { await hit('sre_drift', '/api/v1/sre/drift'); } catch { /* recorded in endpoints */ }
    };
    const fetchIncident = async (id: string) => {
      const [d, tl] = await Promise.all([
        hit('incident', `/api/v1/incidents/${encodeURIComponent(id)}`),
        hit('timeline', `/api/v1/incidents/${encodeURIComponent(id)}/timeline`),
      ]);
      return { detail: toIncidentDetail(d), timeline: own(id, toTimeline(tl)) };
    };
    const store = (id: string, r: { detail: IncidentDetail | null; timeline: TimelineEvent[] }) => setSnap((s) => {
      const details = r.detail ? { ...s.details, [id]: r.detail } : s.details;
      const timelines = { ...s.timelines, [id]: r.timeline };
      const fid = focusId ?? id;
      return { ...s, details, timelines, events: mergeEvents(timelines), focus: details[fid] ?? s.focus, timeline: timelines[fid] ?? s.timeline };
    });
    let ids: string[] = [];
    const pollLists = async () => {
      try {
        const [rel, inc, evs] = await Promise.all([
          hit('releases', '/api/v1/releases?limit=50'),
          hit('incidents', '/api/v1/incidents'),
          hit('events', '/api/v1/events?limit=100').catch(() => []),
        ]);
        if (!alive) return;
        const incidents = toIncidents(inc);
        const globalEvs = toTimeline(evs);
        ids = incidents.slice(0, 12).map((i) => i.id);
        setSnap((s) => ({
          ...s,
          releases: toReleases(rel),
          incidents,
          events: globalEvs.length ? globalEvs : s.events,
        }));
        if (!focusId && incidents[0]) focusId = incidents[0].id;
      } catch { /* status poll reports connectivity */ }
    };
    const pollFocus = async () => {
      const targets = [...new Set([focusId, watchedRef.current].filter((x): x is string => !!x))];
      for (const id of targets) { try { const r = await fetchIncident(id); if (alive) store(id, r); } catch { /* keep the last answer */ } }
    };
    const pollAll = async () => {
      for (const id of ids) { try { const r = await fetchIncident(id); if (alive) store(id, r); } catch { /* keep the last answer */ } }
    };

    pollStatus(); pollHealthz(); pollLists().then(() => { pollFocus(); pollAll(); });
    const a = setInterval(pollStatus, 3000);
    const b = setInterval(pollLists, 10_000);
    const c = setInterval(pollFocus, 4000);
    const d = setInterval(pollAll, 20_000);
    const e = setInterval(pollHealthz, 15_000);
    return () => { alive = false; ctrl.abort(); [a, b, c, d, e].forEach(clearInterval); };
  }, [source, push]);

  const startDemo = useCallback((fail = false) => {
    setDemo({ t0: Date.now(), fail });
    setSource('demo');
    const u = new URL(location.href); u.searchParams.set('demo', fail ? 'fail' : '1'); history.replaceState(null, '', u);
  }, []);
  const exitDemo = useCallback(() => {
    setSource('live');
    const u = new URL(location.href);
    u.searchParams.delete('demo');
    const search = u.searchParams.toString();
    const cleanUrl = u.pathname + (search ? `?${search}` : '') + u.hash;
    history.replaceState(null, '', cleanUrl);
  }, []);

  const watch = useCallback((id: string | null) => setWatched(id), []);

  const stale = source === 'live' && lastOkAt !== null && now - lastOkAt > 12_000;
  const value = useMemo<SentinelCtx>(() => ({
    source, snap, connected, lastOkAt, error, stale, readings, endpoints, demoFail: demo.fail, demoPhase, startDemo, exitDemo, watch,
  }), [source, snap, connected, lastOkAt, error, stale, readings, endpoints, demo.fail, demoPhase, startDemo, exitDemo, watch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** One incident's detail + timeline, polled closely while mounted. */
export function useIncident(id: string | undefined) {
  const { snap, watch } = useSentinel();
  useEffect(() => { watch(id ?? null); return () => watch(null); }, [id, watch]);
  return {
    detail: id ? snap.details[id] ?? null : null,
    summary: id ? snap.incidents?.find((i) => i.id === id) ?? null : null,
    timeline: id ? snap.timelines[id] ?? null : null,
    loaded: !!id && (id in snap.details || id in snap.timelines),
  };
}
