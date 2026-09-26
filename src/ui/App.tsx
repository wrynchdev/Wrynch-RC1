import { useState } from 'react';
import { actions, jobList, useStore } from '../state/store';
import { CreateShop, Join, NewInspection, SetPassword, Settings, SignIn, Team, TemplateEditor } from './account';
import { AdvisorList, AdvisorResults, DemoReport, LiveReport, Rules, VehicleHistory } from './advisor';
import { go, useHash } from './hooks';
import { Logo } from './kit';
import { Capture, ComponentView, Finish, History, Jobs, Missing, Overview, PointView, Setup, Sort, Wording } from './tech';

function route(p: string[]) {
  const [a, b, c, d, e] = p;
  if (!a) return <Jobs />;
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
  if (a === 'settings') return b === 'team' ? <Team /> : b === 'template' ? <TemplateEditor /> : <Settings />;
  if (a === 'account' && b === 'password') return <SetPassword />;
  return <Missing />;
}

function Overlays() {
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  return (
    <>
      {busy && <div className="toast" role="status" style={{ bottom: 'auto', top: 68 }}>{busy}</div>}
      {toast && <div className="toast" role={toast.kind === 'error' ? 'alert' : 'status'} style={toast.kind === 'error' ? { background: 'var(--imm)' } : undefined}>{toast.text}</div>}
    </>
  );
}

export function App() {
  const parts = useHash();
  const [confirmReset, setConfirmReset] = useState(false);
  const s = useStore((x) => x);

  // Customer report links never show the shop app around them.
  if (parts[0] === 'r' && parts[1]) return <><LiveReport token={parts[1]} /><Overlays /></>;

  if (s.mode === 'live') {
    if (parts[0] === 'join' && parts[1]) return <><Join token={parts[1]} /><Overlays /></>;
    if (!s.session) return <><SignIn /><Overlays /></>;
    if (!s.workspace) return <div className="phone"><div className="body"><p className="muted" role="status">Loading your shop…</p></div><Overlays /></div>;
    if (!s.workspace.shop && parts[0] !== 'account') return <><CreateShop /><Overlays /></>;
  }

  const section = parts[0] === 'advisor' || parts[0] === 'vehicle' ? 'advisor'
    : parts[0] === 'settings' || parts[0] === 'rules' ? 'settings' : parts[0] === 'report' ? 'customer' : 'tech';
  const canAdvise = s.mode === 'demo' || s.workspace?.role !== 'technician';
  const latestSent = jobList(s).filter((i) => i.status === 'sent' || i.status === 'submitted').sort((x, y) => y.date.localeCompare(x.date))[0];
  return (
    <>
      <header className="appbar">
        <a className="logo" href="#/" aria-label="Wrynch home"><Logo /><span className="hide-sm">{s.workspace?.shop?.name ?? 'WRYNCH'}</span></a>
        <nav className="roles" aria-label="Sections">
          <button aria-pressed={section === 'tech'} onClick={() => go('/')}>{s.mode === 'demo' ? 'Tech' : 'Jobs'}</button>
          {canAdvise && <button aria-pressed={section === 'advisor'} onClick={() => go('/advisor')}>Advisor</button>}
          {s.mode === 'demo' && <button aria-pressed={section === 'customer'} onClick={() => latestSent && go(`/report/${latestSent.id}`)}>Customer</button>}
          <button aria-pressed={section === 'settings'} onClick={() => go('/settings')}>Settings</button>
        </nav>
        {s.mode === 'demo' && (
          <button className="reset" onClick={() => {
            if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
            setConfirmReset(false); actions.reset(); go('/');
          }}>{confirmReset ? 'Tap again to reset' : 'Reset demo'}</button>
        )}
      </header>
      <div id="content">{route(parts)}</div>
      <Overlays />
    </>
  );
}
