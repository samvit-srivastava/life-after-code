/** Motion layer: backdrop, intro, reveals, tilt + spotlight, count-ups, scramble text. All off under reduced motion. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

export const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Particle network backdrop with a cursor glow ---------------- */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || reduced) return;
    const g = c.getContext('2d')!;
    let w = 0, h = 0, dpr = 1, raf = 0;
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let ps: P[] = [];
    const resize = () => {
      dpr = 1;
      w = innerWidth; h = innerHeight;
      c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(70, (w * h) / 20000));
      ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.4 + 0.4 }));
    };
    const move = (e: PointerEvent) => { mouse.tx = e.clientX; mouse.ty = e.clientY; };
    const leave = () => { mouse.tx = -9999; mouse.ty = -9999; };
    let last = 0;
    const tick = (t: number) => {
      if (t - last < 32) { raf = requestAnimationFrame(tick); return; }
      last = t;
      mouse.x += (mouse.tx - mouse.x) * 0.12; mouse.y += (mouse.ty - mouse.y) * 0.12;
      g.clearRect(0, 0, w, h);
      // cursor glow
      if (mouse.x > -1000) {
        const rg = g.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 320);
        rg.addColorStop(0, 'rgba(143,162,255,0.10)'); rg.addColorStop(1, 'rgba(143,162,255,0)');
        g.fillStyle = rg; g.fillRect(mouse.x - 320, mouse.y - 320, 640, 640);
      }
      for (const p of ps) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 22000) { const f = (22000 - d2) / 22000 * 0.6; p.vx += (dx / Math.sqrt(d2 + 1)) * f * 0.08; p.vy += (dy / Math.sqrt(d2 + 1)) * f * 0.08; }
        p.vx *= 0.985; p.vy *= 0.985;
        p.vx += (Math.random() - 0.5) * 0.01; p.vy += (Math.random() - 0.5) * 0.01;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10; if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      }
      g.lineWidth = 1;
      const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 15000) { const k = d2 < 5000 ? 0 : d2 < 10000 ? 1 : 2; buckets[k].moveTo(a.x, a.y); buckets[k].lineTo(b.x, b.y); }
        }
      }
      [0.16, 0.1, 0.05].forEach((al, k) => { g.strokeStyle = `rgba(143,162,255,${al})`; g.stroke(buckets[k]); });
      const toMouse = new Path2D();
      const dots = new Path2D();
      for (const a of ps) {
        if ((a.x - mouse.x) ** 2 + (a.y - mouse.y) ** 2 < 40000) { toMouse.moveTo(a.x, a.y); toMouse.lineTo(mouse.x, mouse.y); }
        dots.moveTo(a.x + a.r, a.y); dots.arc(a.x, a.y, a.r, 0, 6.283);
      }
      g.strokeStyle = 'rgba(179,155,255,0.22)'; g.stroke(toMouse);
      g.fillStyle = `rgba(200,210,255,${0.55 + 0.2 * Math.sin(t / 900)})`; g.fill(dots);
      raf = requestAnimationFrame(tick);
    };
    resize();
    addEventListener('resize', resize); addEventListener('pointermove', move); document.addEventListener('pointerleave', leave);
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', vis);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="aurora"><i /><i /><i /></div>
      <div className="gridfx" />
      <canvas ref={ref} />
    </div>
  );
}

/* ---------------- Boot intro, once per browser session ---------------- */
export function Intro() {
  const [show, setShow] = useState(() => {
    if (reduced) return false;
    try { return !sessionStorage.getItem('sentinel-intro'); } catch { return true; }
  });
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem('sentinel-intro', '1'); } catch { /* storage blocked */ }
    const a = setTimeout(() => setOut(true), 1900);
    const b = setTimeout(() => setShow(false), 2600);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [show]);
  if (!show) return null;
  return (
    <div className={`intro${out ? ' is-out' : ''}`} onClick={() => setOut(true)} role="presentation">
      <svg viewBox="0 0 64 64" className="intro__logo" aria-hidden="true">
        <path className="intro__shield" d="M32 6 52 14v14c0 13-9 22-20 28C21 50 12 41 12 28V14z" />
        <path className="intro__tick" d="m23 32 6.5 6.5L42 25" />
      </svg>
      <Scramble className="intro__word" text="SENTINEL" duration={1100} />
      <span className="intro__sub">AI proposes · Gates decide · Evidence proves</span>
      <div className="intro__bar"><span /></div>
    </div>
  );
}

/* ---------------- Scramble text: resolves left to right whenever the text changes ---------------- */
const GLYPHS = '!<>-_\\/[]{}—=+*^?#ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
export function Scramble({ text, className, duration = 700, as: Tag = 'span' }: { text: string; className?: string; duration?: number; as?: 'span' | 'h1' | 'h2' }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (reduced) { setOut(text); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const n = Math.floor(k * text.length);
      let s = text.slice(0, n);
      for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setOut(s);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);
  return <Tag className={className} aria-label={text}><span aria-hidden="true">{out}</span></Tag>;
}

/* ---------------- Words that rise in one by one ---------------- */
export function RiseWords({ text, className }: { text: string; className?: string }) {
  return (
    <h1 className={`rise ${className ?? ''}`} key={text} aria-label={text}>
      {text.split(' ').map((w, i, all) => <Fragment key={i}><span className="rise__w" style={{ ['--i' as string]: i }} aria-hidden="true"><span>{w}</span></span>{i < all.length - 1 ? ' ' : ''}</Fragment>)}
    </h1>
  );
}

/* ---------------- Count-up for any value that contains a number ---------------- */
export function CountUp({ value }: { value: ReactNode }) {
  const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const m = str?.match(/-?\d+(\.\d+)?/);
  const target = m ? parseFloat(m[0]) : NaN;
  const dec = m?.[1] ? m[1].length - 1 : 0;
  const [v, setV] = useState(reduced ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target) || reduced) { setV(target); return; }
    let raf = 0;
    const a = from.current, t0 = performance.now(), D = 1100;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 4);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  if (!str || !m || !Number.isFinite(target)) return <>{value}</>;
  // While the tab is hidden no animation frame runs; show the target instead of a stale NaN.
  const shown = Number.isFinite(v) ? v : target;
  return <>{str.slice(0, m.index)}{shown.toFixed(dec)}{str.slice((m.index ?? 0) + m[0].length)}</>;
}

/* ---------------- Global effects: reveals, tilt + spotlight, magnetic buttons ---------------- */
const REVEAL = '.route .phead, .route .sec__head, .route .card, .route .empty, .route .table-wrap, .route .events, .route .rules, .route .stages, .route .note, .route details, .route .filters';

export function useMotion(key: string) {
  // Staggered blur-in as elements enter the viewport, including ones added later.
  useEffect(() => {
    if (reduced) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = '1'; io.unobserve(e.target); }
    }), { rootMargin: '0px 0px 30% 0px' });
    const seen = new WeakSet<Element>();
    const scan = () => {
      const fresh = [...document.querySelectorAll<HTMLElement>(REVEAL)].filter((el) => !seen.has(el) && !el.dataset.in);
      const byParent = new Map<Element | null, number>();
      fresh.forEach((el) => {
        seen.add(el);
        const n = byParent.get(el.parentElement) ?? 0;
        byParent.set(el.parentElement, n + 1);
        if (!el.dataset.r) { el.dataset.r = '1'; el.style.setProperty('--d', `${Math.min(n, 4) * 45}ms`); }
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    const root = document.querySelector('.main');
    if (root) mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [key]);

  // Spotlight + tilt on cards, magnetic pull on buttons.
  useEffect(() => {
    if (reduced || !matchMedia('(hover: hover)').matches) return;
    let tilted: HTMLElement | null = null, mag: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const card = t.closest?.('.card') as HTMLElement | null;
      if (card) {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        card.style.setProperty('--mx', `${x}px`); card.style.setProperty('--my', `${y}px`);
        if (card.classList.contains('tilt')) {
          const rx = ((y / r.height) - 0.5) * -8, ry = ((x / r.width) - 0.5) * 10;
          card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
        }
      }
      if (tilted && tilted !== card) tilted.style.transform = '';
      tilted = card?.classList.contains('tilt') ? card : null;
      const btn = t.closest?.('.btn--primary, .btn--mag') as HTMLElement | null;
      if (btn) {
        const r = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      }
      if (mag && mag !== btn) mag.style.transform = '';
      mag = btn;
    };
    addEventListener('pointermove', move, { passive: true });
    return () => removeEventListener('pointermove', move);
  }, []);
}
