import { useState } from 'react';
import { Training } from './training';
import { Profile } from './profile';
import { actions, declinedItems, getPendingLink, jobList, useStore, type State } from '../state/store';
import { DeclinedWork } from './declined';
import { hostInfo, shopUrl } from '../state/remote';
import { ComponentChecks } from './components';
import { Join, NewInspection, NoShop, Pilot, SetPassword, Settings, SignIn, Team, TemplateEditor } from './account';
import { AdvisorList, AdvisorResults, DemoReport, LiveReport, Rules, VehicleHistory } from './advisor';
import { go, useHash } from './hooks';
import { Icon, Wordmark } from './kit';
import { Dashboard } from './dashboard';
import { Capture, ComponentView, Finish, History, Jobs, Missing, Overview, PointView, Setup, Sort, Wording } from './tech';

function route(p: string[], home: 'dashboard' | 'jobs') {
  const [a, b, c, d, e] = p;
  if (!a || a === 'signup') return home === 'dashboard' ? <Dashboard /> : <Jobs />;
  if (a === 'dashboard') return <Dashboard />;
  if (a === 'jobs') return <Jobs />;
  if (a === 'new') return <NewInspection />;
  if (a === 'setup' && b) return <Setup id={b} />;
  if (a === 'insp' && b) {
    if (!c) return <Overview id={b} />;
    if (c === 'capture' && d) return <Capture id={b} sectionId={d} />;
    if (c === 'sort' && d) return <Sort id={b} sectionId={d} />;
    if (c === 'point' && d) return <PointView id={b} pointId={d} />;
    if (c === 'c' && d) return <ComponentView id={b} compKeyEnc={d} pointId={e} />;
    if (c === 'wording' && d) return <Wording id={b} pointId={d} />;
    if (c === 'finish') return <Finish id={b} />;
  }
  if (a === 'history' && b && c) return <History vehicleId={b} compKeyEnc={c} />;
  if (a === 'advisor') return b ? <AdvisorResults id={b} /> : <AdvisorList />;
  if (a === 'vehicle' && b) return <VehicleHistory vehicleId={b} />;
  if (a === 'rules') return <Rules />;
  if (a === 'report' && b) return <DemoReport id={b} />;
  if (a === 'training') return <Training />;
  if (a === 'profile') return <Profile userId={b} />;
  if (a === 'declined') return <DeclinedWork />;
  if (a === 'settings') return b === 'team' ? <Team /> : b === 'template' ? <TemplateEditor family={c} /> : b === 'components' ? <ComponentChecks family={c} /> : <Settings />;
  if (a === 'account' && b === 'password') return <SetPassword />;
  return <Missing />;
}

function Overlays() {
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  return (
    <>
      {busy && <div className="toast" role="status" style={{ bottom: 'auto', top: 68 }}>{busy}</div>}
      {toast && <div className={`toast${toast.kind === 'error' ? ' err' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}</div>}
    </>
  );
}

let redirecting = false;

// Declined work due for a follow-up, for the menu badge (worked out again only when its inputs change).
let dueMemo: { inputs: unknown[]; n: number } | null = null;
function dueFollowUps(s: State): number {
  const inputs = [s.mode, s.inspections, s.vehicles, s.followups, s.declinedData];
  if (!dueMemo || inputs.some((x, k) => x !== dueMemo!.inputs[k])) dueMemo = { inputs, n: declinedItems(s).filter((i) => i.state === 'due').length };
  return dueMemo.n;
}

export function App() {
  const parts = useHash();
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState(false);
  const s = useStore((x) => x);

  // Customer report links never show the shop app around them.
  if (parts[0] === 'r' && parts[1]) return <><LiveReport token={parts[1]} /><Overlays /></>;

  if (s.mode === 'live') {
    if (parts[0] === 'join' && parts[1]) return <><Join token={parts[1]} /><Overlays /></>;
    if (parts[0] === 'pilot' && parts[1]) return <><Pilot token={parts[1]} /><Overlays /></>;
    if (!s.session) return <><SignIn /><Overlays /></>;
    if (!s.workspace) return <div className="phone"><div className="body"><p className="muted" role="status">Loading your shop…</p></div><Overlays /></div>;
    if (!s.workspace.shop && parts[0] !== 'account') {
      // Back from an email confirmation: pick up the invite or pilot link the person started from.
      const pending = getPendingLink();
      if (pending?.kind === 'join') return <><Join token={pending.token} /><Overlays /></>;
      if (pending?.kind === 'pilot') return <><Pilot token={pending.token} /><Overlays /></>;
      return <><NoShop /><Overlays /></>;
    }
    // Each shop has its own address (1001.wrynch.app). Send people to their shop's address, keeping the page.
    const host = hostInfo();
    const num = s.workspace.shop?.number;
    if (host.onAppDomain && num && host.shopNumber !== num) {
      if (!redirecting) { redirecting = true; window.location.replace(shopUrl(num, window.location.hash)); } // once, even if we re-render
      return <div className="phone"><div className="body"><p className="muted" role="status">Opening {s.workspace.shop?.name}…</p></div></div>;
    }
  }

  const role = s.mode === 'demo' ? 'owner' : s.workspace?.role ?? 'technician';
  const canAdvise = role !== 'technician';
  const home: 'dashboard' | 'jobs' = canAdvise ? 'dashboard' : 'jobs';
  const here = parts[0] ?? '';
  const current = !here || here === 'signup' ? home
    : here === 'insp' || here === 'setup' || here === 'new' || here === 'history' ? 'jobs'
    : here === 'vehicle' ? 'advisor' : here === 'settings' ? (parts[1] ?? 'settings') : here;
  const latestSent = jobList(s).filter((i) => i.status === 'sent' || i.status === 'submitted').sort((x, y) => y.date.localeCompare(x.date))[0];
  const openJobs = jobList(s).filter((j) => j.status === 'not_started' || j.status === 'in_progress').length;
  const toReview = jobList(s).filter((j) => j.status === 'submitted').length;
  const followUps = canAdvise ? dueFollowUps(s) : 0;
  const shopName = s.workspace?.shop?.name ?? (s.mode === 'demo' ? 'Reyes Auto Care' : '');
  const me = s.workspace?.me?.name ?? (s.mode === 'demo' ? 'Jordan L.' : '');
  const initials = (t: string) => t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'W';
  const link = (id: string, href: string, icon: string, label: string, badge?: number) => (
    <a href={href} aria-current={current === id ? 'page' : undefined} onClick={() => setMenu(false)}>
      <Icon name={icon} size={19} />{label}{badge ? <span className="badge">{badge}</span> : null}
    </a>
  );
  return (
    <div className="shell">
      <header className="appbar">
        <button className="iconbtn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu" size={22} /></button>
        <a className="logo" href="#/" aria-label="Wrynch home"><Wordmark height={20} /></a>
        {canAdvise && <a className="btn primary sm" href="#/new"><Icon name="plus" size={16} />New</a>}
      </header>
      <div className={`scrim${menu ? ' open' : ''}`} onClick={() => setMenu(false)} />
      <aside className={`side${menu ? ' open' : ''}`} aria-label="Navigation">
        <a className="brand" href="#/" aria-label="Wrynch home" onClick={() => setMenu(false)}><Wordmark height={24} /></a>
        {shopName && (
          <div className="shop">
            <span className="avatar">{initials(shopName)}</span>
            <span style={{ minWidth: 0 }}><span className="n" style={{ display: 'block' }}>{shopName}</span>
              <span className="d">{s.mode === 'demo' ? 'Demo shop' : `${ROLE_LABEL[role]}${s.workspace?.shop?.number ? ` · #${s.workspace.shop.number}` : ''}`}</span></span>
          </div>
        )}
        {s.mode === 'live' && (s.workspace?.shops.length ?? 0) > 1 && (
          <div className="field">
            <label className="sr" htmlFor="shopsel">Switch shop</label>
            <select id="shopsel" className="input" value={s.workspace?.shop?.id} onChange={(e) => {
              const to = s.workspace!.shops.find((x) => x.id === e.target.value);
              if (!to) return;
              if (hostInfo().onAppDomain && to.number) window.location.assign(shopUrl(to.number, '#/'));
              else { void actions.loadWorkspace(to.id); go('/'); }
              setMenu(false);
            }}>
              {s.workspace!.shops.map((x) => <option key={x.id} value={x.id}>{x.name}{x.number ? ` (#${x.number})` : ''}</option>)}
            </select>
          </div>
        )}
        <nav className="nav" aria-label="Sections">
          {canAdvise && link('dashboard', '#/dashboard', 'dashboard', 'Dashboard')}
          {link('jobs', '#/jobs', 'clipboard', 'Inspections', openJobs)}
          {canAdvise && link('advisor', '#/advisor', 'review', 'Review & send', toReview)}
          {canAdvise && link('declined', '#/declined', 'recover', 'Declined work', followUps)}
          {s.mode === 'demo' && link('report', latestSent ? `#/report/${latestSent.id}` : '#/advisor', 'eye', 'Customer view')}
          <span className="cap">Shop</span>
          {canAdvise && link('rules', '#/rules', 'sliders', 'Rating rules')}
          {canAdvise && link('template', '#/settings/template', 'layers', 'Inspection templates')}
          {canAdvise && link('components', '#/settings/components', 'check', 'Component checks')}
          {s.mode === 'live' && role === 'owner' && link('team', '#/settings/team', 'users', 'Team')}
          {link('settings', '#/settings', 'gear', 'Settings')}
          {s.training?.admin && link('training', '#/training', 'layers', 'Training data')}
        </nav>
        <div className="me">
          <a href="#/profile" className="me-link" onClick={() => setMenu(false)} aria-label="Your profile">
            <span className="avatar round">{initials(me)}</span>
            <span style={{ minWidth: 0 }}><span className="n" style={{ display: 'block' }}>{me || 'Signed in'}</span><span className="d">{ROLE_LABEL[role]}</span></span>
          </a>
          {s.mode === 'demo' ? (
            <button className="iconbtn" title={confirmReset ? 'Tap again to reset the demo' : 'Reset demo'} aria-label={confirmReset ? 'Tap again to reset the demo' : 'Reset demo'}
              style={confirmReset ? { color: 'var(--imm)' } : undefined} onClick={() => {
                if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
                setConfirmReset(false); actions.reset(); go('/');
              }}><Icon name="move" size={18} /></button>
          ) : (
            <button className="iconbtn" title="Sign out" aria-label="Sign out" onClick={() => void actions.signOut()}><Icon name="logout" size={18} /></button>
          )}
        </div>
      </aside>
      <main className="main">
        <div id="content">{route(parts, home)}</div>
      </main>
      <Overlays />
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', advisor: 'Service advisor', technician: 'Technician' };
