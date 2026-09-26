import { useState } from 'react';
import { actions, useStore } from '../state/store';
import { AdvisorList, AdvisorResults, Report, Rules, VehicleHistory } from './advisor';
import { go, useHash } from './hooks';
import { Logo } from './kit';
import { Capture, ComponentView, Finish, History, Jobs, Missing, Overview, PointView, Setup, Sort, Wording } from './tech';

function route(p: string[]) {
  const [a, b, c, d, e] = p;
  if (!a) return <Jobs />;
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
  if (a === 'report' && b) return <Report id={b} />;
  return <Missing />;
}

export function App() {
  const parts = useHash();
  const [confirmReset, setConfirmReset] = useState(false);
  const s = useStore((x) => x);
  const role = parts[0] === 'advisor' || parts[0] === 'vehicle' || parts[0] === 'rules' ? 'advisor' : parts[0] === 'report' ? 'customer' : 'tech';
  const latestSent = [...s.inspections].filter((i) => i.status === 'sent' || i.status === 'submitted').sort((x, y) => y.date.localeCompare(x.date))[0];
  return (
    <>
      <header className="appbar">
        <a className="logo" href="#/" aria-label="Wrynch home"><Logo /><span className="hide-sm">WRYNCH</span></a>
        <nav className="roles" aria-label="View as">
          <button aria-pressed={role === 'tech'} onClick={() => go('/')}>Tech</button>
          <button aria-pressed={role === 'advisor'} onClick={() => go('/advisor')}>Advisor</button>
          <button aria-pressed={role === 'customer'} onClick={() => latestSent && go(`/report/${latestSent.id}`)}>Customer</button>
        </nav>
        <button className="reset" onClick={() => {
          if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
          setConfirmReset(false); actions.reset(); go('/');
        }}>{confirmReset ? 'Tap again to reset' : 'Reset demo'}</button>
      </header>
      <div id="content">{route(parts)}</div>
    </>
  );
}
