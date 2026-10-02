// Component checks: shop owners turn catalog checks off for their shop; Wrynch staff can turn one off for every
// shop. Checks can't be added or edited here, and every part keeps at least one check that is on.
// Turned-off checks disappear from new work; results already recorded on an inspection stay.
import { useMemo, useState } from 'react';
import { canTurnOff, checkOff, ONTOLOGY } from '../domain/ontology';
import type { Check } from '../domain/types';
import { actions, isLive, useStore } from '../state/store';
import { Icon } from './kit';

const METHOD: Record<Check['method'], string> = {
  visual: 'Visual', functional: 'Functional', measurement: 'Measured', test_equipment: 'Test equipment', scan_tool: 'Scan tool', service_interval: 'Service interval',
};
const catLabel = (c: string) => c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

export function ComponentChecks() {
  const role = useStore((s) => s.workspace?.role);
  const off = useStore((s) => s.checksOff);
  const isOwner = !isLive() || role === 'owner';
  const [scope, setScope] = useState<'shop' | 'platform'>('shop');
  const canEdit = scope === 'platform' ? off.admin : isOwner;
  const [q, setQ] = useState('');
  const [multiOnly, setMultiOnly] = useState(true);
  const [onlyOff, setOnlyOff] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const offList = scope === 'platform' ? off.platform : off.shop;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = ONTOLOGY.classes.filter((c) => {
      if (multiOnly && c.checks.length < 2 && !c.checks.some((k) => checkOff(k))) return false;
      if (onlyOff && !c.checks.some((k) => (scope === 'platform' ? off.platform.includes(k) : checkOff(k)))) return false;
      if (!needle) return true;
      return `${c.label} ${c.category}`.toLowerCase().includes(needle) || c.checks.some((k) => ONTOLOGY.checks[k].name.toLowerCase().includes(needle));
    });
    const by = new Map<string, typeof list>();
    for (const c of list) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // checksOff changes re-render through `off`
  }, [q, multiOnly, onlyOff, scope, off]);

  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 960 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Component checks</h1>
        <div className="muted">
          Turn off checks {scope === 'platform' ? 'that no shop should do' : 'your shop doesn’t do'}. Technicians won’t see them on inspections; results
          already recorded stay. Checks can’t be added here, and every part keeps at least one check.
        </div>
      </div>
      {off.admin && (
        <div className="seg" role="group" aria-label="Which checks to change" style={{ maxWidth: 460 }}>
          <button aria-pressed={scope === 'shop'} onClick={() => setScope('shop')}>This shop</button>
          <button aria-pressed={scope === 'platform'} onClick={() => setScope('platform')}>Every shop (Wrynch staff)</button>
        </div>
      )}
      {!canEdit && <div className="card pad small">Only the shop owner can turn checks on or off.</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label className="sr" htmlFor="cc-q">Search parts and checks</label>
        <input id="cc-q" className="input grow" style={{ minWidth: 220 }} placeholder="Search parts or checks (e.g. tire, pressure)" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />Only parts with more than one check</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} />Only parts with checks off</label>
      </div>
      <div className="small muted" role="status">
        {offList.length === 0 ? 'All checks are on.' : `${offList.length} check${offList.length === 1 ? '' : 's'} turned off${scope === 'platform' ? ' for every shop' : ' for this shop'}.`}
        {scope === 'shop' && off.platform.length > 0 && ` ${off.platform.length} more turned off by Wrynch.`}
      </div>
      {groups.length === 0 && <div className="card pad muted">No parts match.</div>}
      {groups.map(([cat, list]) => (
        <section key={cat} className="card">
          <h2 className="group-h">{catLabel(cat)}</h2>
          <div className="list">
            {list.map((c) => {
              const isOpen = open === c.id || !!q.trim();
              const on = c.checks.filter((k) => !checkOff(k)).length;
              return (
                <div key={c.id}>
                  <button className="item" style={{ width: '100%', textAlign: 'left' }} aria-expanded={isOpen} onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <Icon name={isOpen ? 'down' : 'next'} />
                    <span className="grow t">{c.label}</span>
                    <span className={`small ${on < c.checks.length ? '' : 'muted'}`} style={on < c.checks.length ? { color: 'var(--mon)' } : undefined}>
                      {on} of {c.checks.length} on
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 14px 12px 44px' }} className="stack">
                      {c.checks.map((k) => <CheckRow key={k} checkKey={k} scope={scope} canEdit={canEdit} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function CheckRow({ checkKey, scope, canEdit }: { checkKey: string; scope: 'shop' | 'platform'; canEdit: boolean }) {
  useStore((s) => s.checksOff);
  const c = ONTOLOGY.checks[checkKey];
  const byWrynch = checkOff(checkKey) === 'platform';
  const isOn = scope === 'platform' ? !byWrynch : !checkOff(checkKey);
  const lockedByWrynch = scope === 'shop' && byWrynch;
  const lastOne = isOn && !canTurnOff(checkKey, scope);
  const id = `chk-${checkKey.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12, borderTop: '1px solid var(--line2)', paddingTop: 10, opacity: isOn ? 1 : 0.65 }}>
      <input id={id} type="checkbox" role="switch" style={{ width: 22, height: 22, marginTop: 2 }} checked={isOn}
        disabled={!canEdit || lockedByWrynch || lastOne}
        aria-describedby={`${id}-d`}
        onChange={(e) => void actions.setCheckEnabled(checkKey, e.target.checked, scope)} />
      <div className="grow stack" style={{ gap: 3 }}>
        <label htmlFor={id} style={{ fontWeight: 600 }}>{c.name}</label>
        <div id={`${id}-d`} className="small muted">
          {METHOD[c.method]}{c.unit ? ` · ${c.unit}` : ''} · {c.how}
          {lockedByWrynch && <div style={{ color: 'var(--mon)' }}>Turned off by Wrynch for every shop.</div>}
          {lastOne && <div>This part’s only check that’s on, so it stays on.</div>}
        </div>
        <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          <span><b style={{ color: 'var(--ok)' }}>OK</b> {c.bands.ok}</span>
          {c.bands.monitor && <span><b style={{ color: 'var(--mon)' }}>Monitor</b> {c.bands.monitor}</span>}
          {c.bands.immediate && <span><b style={{ color: 'var(--imm)' }}>Immediate</b> {c.bands.immediate}</span>}
        </div>
      </div>
    </div>
  );
}
