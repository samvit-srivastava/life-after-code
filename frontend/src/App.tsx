import { useEffect, useMemo, useState } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SentinelProvider, useSentinel } from './api/source';
import Gates from './pages/Gates';
import Home from './pages/Home';
import IncidentRoom from './pages/IncidentRoom';
import Incidents from './pages/Incidents';
import Ledger from './pages/Ledger';
import Rollout from './pages/Rollout';
import System from './pages/System';
import { derive } from './state/derive';
import { Mission } from './state/mission';
import { Backdrop, Intro, useMotion } from './ui/fx';
import { Icon } from './ui/icons';
import { ago } from './ui/kit';
import { PAGES, Palette } from './ui/palette';

const ICON: Record<string, string> = { '/': 'overview', '/rollout': 'releases', '/incidents': 'incidents', '/gates': 'gates', '/ledger': 'ledger', '/system': 'system' };

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="url(#lg)" />
      <defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32"><stop offset="0" stopColor="#a9b6ff" /><stop offset="1" stopColor="#5d6ee0" /></linearGradient></defs>
      <path d="M16 6.5 24.5 10v6.2c0 4.6-3.5 8.2-8.5 9.8-5-1.6-8.5-5.2-8.5-9.8V10z" fill="none" stroke="#0a0b10" strokeWidth="2" strokeLinejoin="round" />
      <path d="m12.4 16 2.6 2.6 4.8-5" fill="none" stroke="#0a0b10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Link_({ now }: { now: number }) {
  const { source, connected, stale, lastOkAt } = useSentinel();
  const [dot, word, sub] = source === 'demo' ? ['warn', 'Demo scenario', 'scripted data']
    : connected === null ? ['', 'Connecting', 'waiting for the API']
    : !connected ? ['bad', 'API offline', 'nothing here is live']
    : stale ? ['warn', 'Link stale', `last reading ${ago(lastOkAt ?? undefined, now)}`]
    : ['ok', 'Live', `updated ${ago(lastOkAt ?? undefined, now)}`];
  return (
    <div className="link" role="status">
      <span className={`dot dot--${dot}${dot === 'ok' ? ' dot--live' : ''}`} />
      <span>{word}<small>{sub}</small></span>
    </div>
  );
}

function DemoBar() {
  const { source, demoFail, exitDemo, startDemo } = useSentinel();
  if (source !== 'demo') return null;
  return (
    <div className="demo-bar" role="note">
      <b>Demo scenario</b>
      <span>Scripted data, not telemetry. {demoFail ? 'This run shows the gates blocking a repair.' : 'This run shows a full recovery.'}</span>
      <div className="row">
        <button className="btn btn--sm" onClick={() => startDemo(!demoFail)}>{demoFail ? 'Play success path' : 'Play blocked path'}</button>
        <button className="btn btn--sm" onClick={exitDemo}>Exit demo</button>
      </div>
    </div>
  );
}

function NotFound() {
  return <div className="empty"><b>No such page.</b><Link to="/">Back to the overview</Link></div>;
}

function Shell() {
  const { snap, connected, source, startDemo, exitDemo } = useSentinel();
  const loc = useLocation();
  const nav = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const d = useMemo(() => derive(snap, connected, now), [snap, connected, now]);
  const [palette, setPalette] = useState(false);

  useEffect(() => { scrollTo(0, 0); }, [loc.pathname]);

  // ⌘K / Ctrl+K or "/" opens the palette; 1–6 jump between pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); return; }
      if (typing || palette || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setPalette(true); }
      const n = Number(e.key);
      if (n >= 1 && n <= PAGES.length) nav(PAGES[n - 1].to);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [palette, nav]);

  useMotion(loc.pathname);
  const ctx = useMemo(() => ({ d, now }), [d, now]);
  return (
    <Mission.Provider value={ctx}>
      <Backdrop />
      <Intro />
      <div className="shell">
        <aside className="side">
          <Link to="/" className="brand" onClick={() => { if (source === 'demo') exitDemo(); }}><Logo /><div><b>Sentinel</b><span>Mission Control</span></div></Link>

          <nav className="nav" aria-label="Pages">
            <span className="nav__k">Console</span>
            {PAGES.map((p, i) => (
              <NavLink key={p.to} to={p.to} end={p.to === '/'} className={({ isActive }) => (isActive || (p.to === '/incidents' && loc.pathname.startsWith('/incidents')) ? 'is-on' : '')}>
                <Icon name={ICON[p.to]} />{p.label}<kbd>{i + 1}</kbd>
              </NavLink>
            ))}
          </nav>
          <div className="side__foot">
            <Link_ now={now} />
            {source === 'live' && <button className="btn" onClick={() => startDemo(false)}><Icon name="play" />Play demo</button>}
            <button className="search-hint" onClick={() => setPalette(true)}><span>Search</span><kbd>Ctrl K</kbd></button>
          </div>
        </aside>
        <main className="main">
          <div className="wrap">
            <DemoBar />
            <div className="route" key={loc.pathname}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/rollout" element={<Rollout />} />
              <Route path="/incidents" element={<Incidents />} />
              <Route path="/incidents/:id" element={<IncidentRoom />} />
              <Route path="/gates" element={<Gates />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/system" element={<System />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </div>
          </div>
        </main>
        <Palette open={palette} onClose={() => setPalette(false)} />
        <p className="sr-only" role="status" aria-live="polite">{d.headline}</p>
      </div>
    </Mission.Provider>
  );
}

export default function App() {
  return (
    <SentinelProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SentinelProvider>
  );
}
