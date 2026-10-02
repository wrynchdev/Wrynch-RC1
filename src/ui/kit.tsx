import type { ReactNode } from 'react';
import type { ComponentState } from '../domain/types';
import { WORDMARK } from './logoPaths';

const P: Record<string, ReactNode> = {
  back: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M6 12.5l4 4L18 8" />,
  ok: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  monitor: <><path d="M12 3.5L21.5 20h-19z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  immediate: <><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" /><path d="M12 7.5v5" /><path d="M12 16.5h.01" /></>,
  na: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
  ai: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  download: <><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></>,
  text: <path d="M4 6h16M4 12h10M4 18h13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  move: <><path d="M7 7h11l-3-3" /><path d="M17 17H6l3 3" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7" height="8" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="14.5" width="7" height="6" rx="1.5" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M9 10h6M9 14h6M9 18h3" /></>,
  review: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8.5 10.5l2 2 4-4" /></>,
  send: <path d="M4 12l16-8-6 16-3-6z" />,
  dollar: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2c1.6.3 2.8.9 2.8 2.2s-1.2 2.1-2.8 2.1c-1.2 0-2.3-.5-2.8-1.5M12 6.5v11" /></>,
  approve: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.8 3.1 2.6 3.5 5.2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  car: <><path d="M5 16h14v-4l-2-5H7l-2 5z" /><circle cx="8" cy="16.5" r="1.8" /><circle cx="16" cy="16.5" r="1.8" /><path d="M5 12h14" /></>,
};

export function Icon({ name, size = 18, label, stroke = 2.2 }: { name: keyof typeof P | string; size?: number; label?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {P[name]}
    </svg>
  );
}

/** The Wrynch wrench (from the official logo). Takes the text color. */
/** The full WRYNCH wordmark (official logo). Takes the text color. */
export function Wordmark({ height = 32 }: { height?: number }) {
  return (
    <svg height={height} width={(height * WORDMARK.w) / WORDMARK.h} viewBox={`0 0 ${WORDMARK.w} ${WORDMARK.h}`} role="img" aria-label="Wrynch">
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK.d} />
    </svg>
  );
}

const STATE_LABEL: Record<ComponentState, string> = {
  ok: 'OK', monitor: 'Monitor', immediate: 'Immediate', not_inspected: 'Not inspected',
  unable_to_assess: 'Unable to assess', unrated: 'Not rated',
};
export const CUSTOMER_LABEL: Record<string, string> = { ok: 'Good', monitor: 'Plan for', immediate: 'Replace now' };

export function StateChip({ state, large, customer }: { state: ComponentState; large?: boolean; customer?: boolean }) {
  const cls = state === 'ok' || state === 'monitor' || state === 'immediate' ? state : 'na';
  const icon = cls === 'na' ? 'na' : state;
  const label = customer && CUSTOMER_LABEL[state] ? CUSTOMER_LABEL[state] : STATE_LABEL[state];
  if (state === 'unrated') return <span className={`chip na${large ? ' lg' : ''}`}>{label}</span>;
  return <span className={`chip ${cls}${large ? ' lg' : ''}`}><Icon name={icon} size={large ? 16 : 14} stroke={2.4} />{label}</span>;
}

export function AiChip({ children }: { children: ReactNode }) {
  return <span className="chip ai"><Icon name="ai" size={14} stroke={2} />{children}</span>;
}

export function TopBar({ title, sub, back, right }: { title: string; sub?: string; back?: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      {back ? <a className="iconbtn" href={back} aria-label="Back"><Icon name="back" size={22} /></a> : <span style={{ width: 12 }} />}
      <div className="grow">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="handle" />
        <div className="row between">
          <h2 className="h2" style={{ fontSize: 20 }}>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tile({ kind, n, label }: { kind: string; n: number; label: string }) {
  const icon = kind === 'ai' ? 'ai' : kind === 'na' ? 'na' : kind;
  return (
    <div className={`tile ${kind}`}>
      <Icon name={icon} size={18} />
      <span className="n">{n}</span>
      <span className="l">{label}</span>
    </div>
  );
}

export const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtMi = (n: number) => `${n.toLocaleString('en-US')} mi`;
