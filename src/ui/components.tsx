// Component checks: shop owners choose which catalog checks each inspection template uses (a courtesy check can
// look at the brakes without measuring them; a brake inspection measures everything). Wrynch staff can turn a check
// off for every shop. Checks can't be added or edited here, and every part keeps at least one check that is on.
// A template's choices are saved as a new version of the template: inspections already started keep theirs.
import { useMemo, useState } from 'react';
import { canTurnOff, checkOff, ONTOLOGY } from '../domain/ontology';
import type { Check } from '../domain/types';
import { actions, isLive, templateList, toast, useStore, type TemplateEntry } from '../state/store';
import { go } from './hooks';
import { Icon } from './kit';

const METHOD: Record<Check['method'], string> = {
  visual: 'Visual', functional: 'Functional', measurement: 'Measured', test_equipment: 'Test equipment', scan_tool: 'Scan tool', service_interval: 'Service interval',
};
const catLabel = (c: string) => c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function ComponentChecks({ family }: { family?: string }) {
  const s = useStore((x) => x);
  const list = templateList(s);
  const entry = list.find((x) => x.family === family) ?? list.find((x) => x.isDefault) ?? list[0];
  const [scope, setScope] = useState<'template' | 'platform'>('template');
  if (!entry) return <div className="wide"><p className="muted" role="status">Loading templates…</p></div>;
  // Re-key on the template version so a saved or switched template starts a fresh draft.
  return <ChecksEditor key={`${entry.family}:${entry.version}`} entry={entry} list={list} scope={scope} setScope={setScope} />;
}

function ChecksEditor({ entry, list, scope, setScope }: { entry: TemplateEntry; list: TemplateEntry[]; scope: 'template' | 'platform'; setScope: (s: 'template' | 'platform') => void }) {
  const role = useStore((s) => s.workspace?.role);
  const off = useStore((s) => s.checksOff);
  const isOwner = !isLive() || role === 'owner';
  const canEdit = scope === 'platform' ? off.admin : isOwner;
  const saved = entry.data.checksOff ?? [];
  const [draft, setDraft] = useState<string[]>(saved);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [multiOnly, setMultiOnly] = useState(true);
  const [onlyOff, setOnlyOff] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const dirty = !same(draft, saved);

  const isOff = (k: string) => (scope === 'platform' ? off.platform.includes(k) : checkOff(k, draft) !== null);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = ONTOLOGY.classes.filter((c) => {
      if (multiOnly && c.checks.length < 2 && !c.checks.some(isOff)) return false;
      if (onlyOff && !c.checks.some(isOff)) return false;
      if (!needle) return true;
      return `${c.label} ${c.category}`.toLowerCase().includes(needle) || c.checks.some((k) => ONTOLOGY.checks[k].name.toLowerCase().includes(needle));
    });
    const by = new Map<string, typeof shown>();
    for (const c of shown) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // isOff reads scope, draft and off
  }, [q, multiOnly, onlyOff, scope, draft, off]);

  const toggle = (k: string, on: boolean) => {
    if (scope === 'platform') { void actions.setPlatformCheckEnabled(k, on); return; }
    setDraft(on ? draft.filter((x) => x !== k) : [...draft, k].sort());
  };
  const save = async () => {
    setSaving(true);
    try { await actions.saveTemplate({ ...entry.data, checksOff: [...draft].sort() }, entry.family); } catch (e) { toast(errText(e), 'error'); } finally { setSaving(false); }
  };
  const offCount = scope === 'platform' ? off.platform.length : draft.filter((k) => checkOff(k, []) === null).length;

  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 960 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Component checks</h1>
        <div className="muted">
          {scope === 'platform'
            ? 'Turn off checks that no shop should do. Results already recorded stay.'
            : 'Choose which checks technicians do on each inspection template. A courtesy check can look at the brakes without measuring them; a brake inspection can measure everything. Saving makes a new version of the template; inspections already started keep theirs.'}
          {' '}Checks can’t be added here, and every part keeps at least one check.
        </div>
      </div>
      {off.admin && (
        <div className="seg" role="group" aria-label="Which checks to change" style={{ maxWidth: 460 }}>
          <button aria-pressed={scope === 'template'} onClick={() => setScope('template')}>A template</button>
          <button aria-pressed={scope === 'platform'} onClick={() => setScope('platform')}>Every shop (Wrynch staff)</button>
        </div>
      )}
      {scope === 'template' && (
        <div className="card pad row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="field grow" style={{ minWidth: 220 }}>
            <label htmlFor="cc-t">Template</label>
            <select id="cc-t" className="input" value={entry.family} onChange={(e) => {
              if (dirty && !window.confirm('Leave without saving your check changes?')) return;
              go(`/settings/components/${e.target.value}`);
            }}>
              {list.map((t) => <option key={t.family} value={t.family}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
            </select>
          </div>
          <a className="linkbtn" href={`#/settings/template/${entry.family}`}>Edit this template’s points</a>
          {canEdit && (
            <div className="row" style={{ marginLeft: 'auto' }}>
              {dirty && <button className="btn quiet sm" onClick={() => setDraft(saved)}>Discard</button>}
              <button className="btn primary sm" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save checks'}</button>
            </div>
          )}
        </div>
      )}
      {!canEdit && <div className="card pad small">{scope === 'platform' ? 'Only Wrynch staff can change these.' : 'Only the shop owner can turn checks on or off.'}</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label className="sr" htmlFor="cc-q">Search parts and checks</label>
        <input id="cc-q" className="input grow" style={{ minWidth: 220 }} placeholder="Search parts or checks (e.g. tire, pressure)" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />Only parts with more than one check</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} />Only parts with checks off</label>
      </div>
      <div className="small muted" role="status">
        {offCount === 0 ? 'All checks are on.' : `${offCount} check${offCount === 1 ? '' : 's'} turned off${scope === 'platform' ? ' for every shop' : ` in ${entry.name}`}.`}
        {scope === 'template' && off.platform.length > 0 && ` ${off.platform.length} more turned off by Wrynch.`}
        {dirty && ' Not saved yet.'}
      </div>
      {groups.length === 0 && <div className="card pad muted">No parts match.</div>}
      {groups.map(([cat, shown]) => (
        <section key={cat} className="card">
          <h2 className="group-h">{catLabel(cat)}</h2>
          <div className="list">
            {shown.map((c) => {
              const isOpen = open === c.id || !!q.trim();
              const on = c.checks.filter((k) => !isOff(k)).length;
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
                      {c.checks.map((k) => {
                        const byWrynch = off.platform.includes(k);
                        const isOn = !isOff(k);
                        const locked = scope === 'template' && byWrynch;
                        const lastOne = isOn && !(scope === 'platform' ? canTurnOff(k, 'platform') : canTurnOff(k, 'template', draft));
                        return <CheckRow key={k} checkKey={k} isOn={isOn} disabled={!canEdit || locked || lastOne}
                          note={locked ? 'Turned off by Wrynch for every shop.' : lastOne ? 'This part’s only check that’s on, so it stays on.' : null}
                          onChange={(v) => toggle(k, v)} />;
                      })}
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

function CheckRow({ checkKey, isOn, disabled, note, onChange }: { checkKey: string; isOn: boolean; disabled: boolean; note: string | null; onChange: (on: boolean) => void }) {
  const c = ONTOLOGY.checks[checkKey];
  const id = `chk-${checkKey.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12, borderTop: '1px solid var(--line2)', paddingTop: 10, opacity: isOn ? 1 : 0.65 }}>
      <input id={id} type="checkbox" role="switch" style={{ width: 22, height: 22, marginTop: 2 }} checked={isOn} disabled={disabled}
        aria-describedby={`${id}-d`} onChange={(e) => onChange(e.target.checked)} />
      <div className="grow stack" style={{ gap: 3 }}>
        <label htmlFor={id} style={{ fontWeight: 600 }}>{c.name}</label>
        <div id={`${id}-d`} className="small muted">
          {METHOD[c.method]}{c.unit ? ` · ${c.unit}` : ''} · {c.how}
          {note && <div style={note.startsWith('Turned off') ? { color: 'var(--mon)' } : undefined}>{note}</div>}
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
