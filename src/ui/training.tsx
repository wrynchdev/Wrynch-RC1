// Training data: Wrynch staff draw boxes around the parts technicians confirmed on photos from shops that share
// training data. The part detector (or the AI) pre-draws a first guess; staff fix, approve or skip; approved boxes are exported for training.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { clampBox, labelParts, TARGET_PER_CLASS, type TrainingBox } from '../domain/training';
import { cls } from '../domain/ontology';
import { actions, toast, useStore, type TrainingItem, type TrainingStats } from '../state/store';
import { Icon } from './kit';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const COLORS = ['#4F8BFF', '#F2B84B', '#4CC38A', '#F47C75', '#BBA8FF', '#5CD0E0', '#FF9F5A', '#E07CC8'];
type Box = TrainingBox & { id: number };
type Drag = { kind: 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; id: number; x0: number; y0: number; start: Box };
let seq = 1;

export function Training() {
  const admin = useStore((s) => s.training?.admin);
  const [items, setItems] = useState<TrainingItem[] | null>(null);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [armed, setArmed] = useState(0); // which confirmed part a new box gets
  const [busy, setBusy] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const load = useCallback(async () => {
    setBusy('Loading photos…');
    try { const r = await actions.trainingQueue(); setItems(r.items); setStats(r.stats); setIdx(0); } catch (e) { toast(errText(e), 'error'); setItems([]); } finally { setBusy(null); }
  }, []);
  useEffect(() => { if (admin) void load(); }, [admin, load]);

  const item = items?.[idx] ?? null;
  const parts = item ? labelParts(item.parts) : [];
  const colorOf = (b: Pick<TrainingBox, 'classId' | 'position'>) => COLORS[Math.max(0, parts.findIndex((p) => p.classId === b.classId && p.position === b.position)) % COLORS.length];

  // New photo: clear, then ask the AI for first-guess boxes.
  useEffect(() => {
    setBoxes([]); setSel(null); setArmed(0); setSize({ w: 0, h: 0 });
    if (!item) return;
    let live = true;
    setBusy('Pre-drawing boxes…');
    actions.suggestBoxes(item.mediaId)
      .then((r) => { if (live) { setBoxes(r.boxes.map((b) => ({ ...b, id: seq++ }))); if (r.note) toast(r.note); } })
      .catch((e) => { if (live) toast(`${errText(e)} Draw the boxes by hand.`, 'error'); })
      .finally(() => { if (live) setBusy(null); });
    return () => { live = false; };
  }, [item?.mediaId]);

  const next = () => { if (items && idx + 1 < items.length) setIdx(idx + 1); else void load(); };
  const save = async (status: 'approved' | 'skipped') => {
    if (!item) return;
    if (status === 'approved' && !boxes.length) { toast('Draw at least one box, or skip the photo.', 'error'); return; }
    setBusy(status === 'approved' ? 'Saving…' : 'Skipping…');
    try {
      await actions.saveTrainingLabel(item.mediaId, status, boxes.map(({ id: _id, ...b }) => clampBox(b)), size.w, size.h);
      setStats((s) => s && {
        ...s, waiting: Math.max(0, s.waiting - 1),
        approved: s.approved + (status === 'approved' ? 1 : 0), skipped: s.skipped + (status === 'skipped' ? 1 : 0),
        classes: status === 'approved' ? boxes.reduce((c, b) => ({ ...c, [b.classId]: (c[b.classId] ?? 0) + 1 }), { ...s.classes }) : s.classes,
      });
      next();
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(null); }
  };

  // Keyboard: Enter approve, S skip, Delete remove the selected box, 1-9 choose the part for the next box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'Enter') { e.preventDefault(); void save('approved'); }
      else if (e.key === 's' || e.key === 'S') void save('skipped');
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) { e.preventDefault(); setBoxes((bs) => bs.filter((b) => b.id !== sel)); setSel(null); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= parts.length) setArmed(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: RPointerEvent, kind: Drag['kind'], box?: Box) => {
    e.preventDefault(); e.stopPropagation();
    frame.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (kind === 'draw') {
      const part = parts[armed];
      if (!part) return;
      const b: Box = { id: seq++, classId: part.classId, position: part.position, x: p.x, y: p.y, w: 0.001, h: 0.001, source: 'human' };
      setBoxes((bs) => [...bs, b]); setSel(b.id);
      drag.current = { kind, id: b.id, x0: p.x, y0: p.y, start: b };
    } else if (box) {
      setSel(box.id);
      drag.current = { kind, id: box.id, x0: p.x, y0: p.y, start: box };
    }
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pos(e), s = d.start;
    let b: Box;
    if (d.kind === 'draw') b = { ...s, x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
    else if (d.kind === 'move') b = { ...s, x: Math.min(Math.max(0, s.x + p.x - d.x0), 1 - s.w), y: Math.min(Math.max(0, s.y + p.y - d.y0), 1 - s.h) };
    else {
      const l = d.kind.includes('w') ? p.x : s.x, r = d.kind.includes('e') ? p.x : s.x + s.w;
      const t = d.kind.includes('n') ? p.y : s.y, btm = d.kind.includes('s') ? p.y : s.y + s.h;
      b = { ...s, x: Math.min(l, r), y: Math.min(t, btm), w: Math.abs(r - l), h: Math.abs(btm - t) };
    }
    b.source = 'human';
    setBoxes((bs) => bs.map((x) => (x.id === d.id ? b : x)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw') setBoxes((bs) => bs.filter((b) => b.id !== d.id || (b.w > 0.01 && b.h > 0.01)));
  };

  if (admin === false) return <div className="wide"><h1 className="display" style={{ fontSize: 36 }}>Training data</h1><p className="muted">Only Wrynch staff can label training photos.</p></div>;
  const selected = boxes.find((b) => b.id === sel) ?? null;
  const classRows = Object.entries(stats?.classes ?? {}).map(([id, n]) => ({ id: Number(id), n, label: (() => { try { return cls(Number(id)).label; } catch { return `Part ${id}`; } })() }))
    .sort((a, b) => a.n - b.n);

  return (
    <div className="wide stack training" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Training data</h1>
          <p className="small muted" style={{ margin: 0 }}>Box each part a technician confirmed. Only photos from shops that share training data appear here.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary sm" disabled={!!busy || !stats?.approved} onClick={async () => {
            setBusy('Preparing export…');
            try { const n = await actions.exportTrainingData(); toast(`Exported ${n} photos. Photo links in the file work for 7 days.`); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(null); }
          }}><Icon name="download" size={16} />Export dataset</button>
        </div>
      </div>

      {stats && (
        <div className="kpis train-kpis">
          <div className="card pad"><b>{stats.approved}</b><span>photos approved</span></div>
          <div className="card pad"><b>{stats.waiting}</b><span>waiting</span></div>
          <div className="card pad"><b>{stats.skipped}</b><span>skipped</span></div>
          <div className="card pad"><b>{stats.shops}</b><span>{stats.shops === 1 ? 'shop sharing' : 'shops sharing'}</span></div>
        </div>
      )}

      {items && !item && <div className="card pad">Nothing to label right now. Photos appear here once a sharing shop’s technicians confirm parts on them.</div>}

      {item && (
        <div className="train-grid">
          <div className="stack" style={{ gap: 8 }}>
            <div className="small muted">Shop #{item.shop} · {item.vehicle} · {item.stage.replace(/_/g, ' ')} · photo {idx + 1} of {items!.length}</div>
            <div ref={frame} className="train-frame" onPointerDown={(e) => down(e, 'draw')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              {item.url ? <img src={item.url} alt="Inspection photo to label" draggable={false}
                onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} /> : <div className="pad muted">Photo unavailable</div>}
              {boxes.map((b) => (
                <div key={b.id} className={`tbox${b.id === sel ? ' sel' : ''}`} onPointerDown={(e) => down(e, 'move', b)}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, borderColor: colorOf(b) }}>
                  <span className="tlabel" style={{ background: colorOf(b) }}>{parts.find((p) => p.classId === b.classId && p.position === b.position)?.label ?? cls(b.classId).label}{b.source === 'ai' ? ' · AI' : ''}</span>
                  {b.id === sel && (['nw', 'ne', 'sw', 'se'] as const).map((h) => <i key={h} className={`th ${h}`} onPointerDown={(e) => down(e, h, b)} />)}
                </div>
              ))}
              {busy && <div className="train-busy" role="status">{busy}</div>}
            </div>
            <div className="small muted">Drag on the photo to draw a box for the selected part. Drag a box to move it, its corners to resize. Keys: 1–9 choose part · Delete removes · Enter approves · S skips.</div>
          </div>

          <aside className="stack" style={{ gap: 12 }}>
            <section className="card pad stack" style={{ gap: 8 }}>
              <h2 className="h2" style={{ margin: 0 }}>Confirmed parts</h2>
              {parts.map((p, k) => {
                const n = boxes.filter((b) => b.classId === p.classId && b.position === p.position).length;
                return (
                  <button key={p.key} className={`tpart${armed === k ? ' on' : ''}`} onClick={() => setArmed(k)} aria-pressed={armed === k}>
                    <i style={{ background: COLORS[k % COLORS.length] }} /><span className="grow">{k + 1}. {p.label}</span>
                    <span className={n ? 'ok' : 'muted'}>{n ? `${n} box${n === 1 ? '' : 'es'}` : 'no box'}</span>
                  </button>
                );
              })}
              <span className="small muted">Leave a part without a box if it isn’t really visible in the photo.</span>
            </section>
            {selected && (
              <section className="card pad stack" style={{ gap: 8 }}>
                <label className="label" htmlFor="tbox-part">Selected box</label>
                <select id="tbox-part" className="input" value={parts.findIndex((p) => p.classId === selected.classId && p.position === selected.position)}
                  onChange={(e) => { const p = parts[Number(e.target.value)]; setBoxes((bs) => bs.map((b) => (b.id === selected.id ? { ...b, classId: p.classId, position: p.position, source: 'human' } : b))); }}>
                  {parts.map((p, k) => <option key={p.key} value={k}>{p.label}</option>)}
                </select>
                <button className="btn quiet sm" onClick={() => { setBoxes((bs) => bs.filter((b) => b.id !== selected.id)); setSel(null); }}>Delete box</button>
              </section>
            )}
            <div className="row">
              <button className="btn quiet" disabled={!!busy} onClick={() => void save('skipped')}>Skip</button>
              <button className="btn primary grow" disabled={!!busy || !boxes.length} onClick={() => void save('approved')}><Icon name="check" size={18} />Approve {boxes.length} {boxes.length === 1 ? 'box' : 'boxes'}</button>
            </div>
            {classRows.length > 0 && (
              <section className="card pad stack" style={{ gap: 6 }}>
                <h2 className="h2" style={{ margin: 0 }}>Boxes per part type</h2>
                <span className="small muted">About {TARGET_PER_CLASS} good examples per part type is a common starting point. Fewest first.</span>
                {classRows.slice(0, 12).map((c) => (
                  <div key={c.id} className="tprog"><span>{c.label}</span><span className="bar"><i style={{ width: `${Math.min(100, (c.n / TARGET_PER_CLASS) * 100)}%` }} /></span><b>{c.n}</b></div>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Settings: an owner shares the shop's confirmed photos to help train Wrynch's AI (off by default). */
export function TrainingShareCard() {
  const role = useStore((s) => s.workspace?.role);
  const info = useStore((s) => s.training);
  if (!info) return null;
  return (
    <section className="card pad stack" aria-labelledby="tr-h">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <h2 id="tr-h" className="h2" style={{ margin: 0 }}>Help improve Wrynch’s AI</h2>
          <div className="small muted">Share this shop’s technician-confirmed inspection photos so Wrynch staff can use them to train better part detection. Customer names, prices and notes are never shared. Licence plates or other details can appear in photos. Off unless you turn it on, and you can turn it off at any time.</div>
        </div>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={info.shared} disabled={role !== 'owner'} onChange={(e) => void actions.setShareTraining(e.target.checked)} style={{ width: 22, height: 22 }} />
          {info.shared ? 'Sharing' : 'Not sharing'}
        </label>
      </div>
      {role !== 'owner' && <span className="small muted">Only the shop owner can change this.</span>}
    </section>
  );
}
