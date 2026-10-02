import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  cls, compLabel, CONDITIONS, currentTemplate, DEFAULT_TEMPLATE, ONTOLOGY, positionLabel,
} from '../domain/ontology';
import type { Template, TemplateComponent, VehicleConfig } from '../domain/types';
import { VEHICLES } from '../domain/seed';
import { actions, isLive, noteStyle, setPendingLink, toast, useStore, type Role } from '../state/store';
import { TekmetricCard, TekmetricPull } from './tekmetric';
import { AiKeyCard } from './aiKey';
import { TrainingShareCard } from './training';
import { NOTE_STYLES, type NoteStyle } from '../domain/noteDraft';
import { optimizeOrder, PHASES } from '../domain/templateOrder';
import { go } from './hooks';
import { Icon, TopBar, Wordmark } from './kit';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

// ------------------------------------------------------------------ sign in / sign up
/**
 * Sign-in screen. Creating an account is only offered from an invite link or an approved pilot link
 * (allowSignUp); the database enforces it too (create_shop needs a pilot link).
 */
export function SignIn({ after, allowSignUp = false, startWithSignUp = false, initialEmail = '' }:
  { after?: () => Promise<void> | void; allowSignUp?: boolean; startWithSignUp?: boolean; initialEmail?: string }) {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>(allowSignUp && startWithSignUp ? 'up' : 'in');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') { await actions.signIn(email.trim(), password); await after?.(); }
      else if (mode === 'up') {
        const signedIn = await actions.signUp(email.trim(), password, name.trim());
        if (signedIn) await after?.();
        else setMsg({ kind: 'info', text: `We sent a confirmation link to ${email.trim()}. Open it on this device, then sign in.` });
      } else {
        await actions.resetPassword(email.trim());
        setMsg({ kind: 'info', text: `If ${email.trim()} has an account, a reset link is on its way.` });
      }
    } catch (err) { setMsg({ kind: 'error', text: errText(err) }); } finally { setBusy(false); }
  };
  return (
    <div className="phone">
      <div className="body" style={{ gap: 18, paddingTop: 40 }}>
        <div style={{ color: 'var(--ink)' }}><Wordmark height={34} /></div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h1>
        <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
          {mode === 'up' && (
            <div className="field"><label htmlFor="nm">Your name (shown on inspections)</label>
              <input id="nm" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div className="field"><label htmlFor="em">Email</label>
            <input id="em" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {mode !== 'reset' && (
            <div className="field"><label htmlFor="pw">Password{mode === 'up' ? ' (at least 8 characters)' : ''}</label>
              <input id="pw" className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={mode === 'up' ? 8 : undefined}
                required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          )}
          {msg && <div className={msg.kind === 'error' ? 'card pad' : 'card pad'} role="alert" style={{ color: msg.kind === 'error' ? 'var(--imm)' : 'var(--ink)' }}>{msg.text}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        </form>
        <div className="stack" style={{ gap: 4 }}>
          {mode !== 'in' && <button className="linkbtn" style={{ textAlign: 'left' }} onClick={() => { setMode('in'); setMsg(null); }}>I have an account: sign in</button>}
          {allowSignUp && mode !== 'up' && <button className="linkbtn" style={{ textAlign: 'left' }} onClick={() => { setMode('up'); setMsg(null); }}>New here: create an account</button>}
          {mode === 'in' && <button className="linkbtn" style={{ textAlign: 'left' }} onClick={() => { setMode('reset'); setMsg(null); }}>Forgot your password?</button>}
        </div>
        {!allowSignUp && (
          <div className="card pad small">New to Wrynch? We're onboarding shops through our pilot program. <a href="/#pilot" style={{ fontWeight: 700 }}>Apply for the pilot</a>.
            Joining your shop's team? Open the invite link your shop owner sent you.</div>
        )}
      </div>
    </div>
  );
}

export function SetPassword() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="phone"><TopBar title="Choose a new password" back="#/" />
      <form className="body" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await actions.setPassword(pw); toast('Password updated'); go('/'); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
      }}>
        <div className="field"><label htmlFor="npw">New password (at least 8 characters)</label>
          <input id="npw" className="input" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <button className="btn primary" disabled={busy}>Save password</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ first run: create a shop (pilot link) or join one
/** Signed in but not in any shop, with no invite or pilot link in hand. */
export function NoShop() {
  return (
    <div className="phone">
      <div className="body" style={{ gap: 16, paddingTop: 32 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>You're not in a shop yet</h1>
        <p className="muted" style={{ margin: 0 }}>Joining your shop's team? Open the invite link your shop owner sent you on this device.</p>
        <div className="card pad small">Setting up a new shop? Wrynch is onboarding shops through a pilot program. <a href="/#pilot" style={{ fontWeight: 700 }}>Apply for the pilot</a> and we'll send you a sign-up link.</div>
        <button type="button" className="linkbtn" style={{ textAlign: 'left' }} onClick={() => void actions.signOut()}>Sign out</button>
      </div>
    </div>
  );
}

/** An approved pilot link: create an account (if needed), then the shop. */
export function Pilot({ token }: { token: string }) {
  const session = useStore((s) => s.session);
  const [info, setInfo] = useState<{ shopName: string; contactName: string; email: string } | null | undefined>(undefined);
  useEffect(() => {
    setPendingLink({ kind: 'pilot', token });
    actions.pilotInvite(token).then((r) => setInfo(r ?? null)).catch(() => setInfo(null));
  }, [token]);
  if (info === undefined) return <div className="phone"><div className="body"><p className="muted" role="status">Checking your pilot link…</p></div></div>;
  if (info === null) {
    return (
      <div className="phone"><div className="body" style={{ gap: 16, paddingTop: 32 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>This pilot link isn't valid</h1>
        <p className="muted" style={{ margin: 0 }}>It may have been used already or expired. If your shop is already set up, <a href="#/" onClick={() => setPendingLink(null)}>sign in</a>. Otherwise reply to your pilot email and we'll send a new link.</p>
      </div></div>
    );
  }
  if (!session) {
    return (
      <div>
        <div className="phone" style={{ minHeight: 0 }}><div className="body" style={{ paddingBottom: 0 }}>
          <div className="card pad">Welcome to the Wrynch pilot{info.contactName ? `, ${info.contactName.split(' ')[0]}` : ''}. Create your account to set up <strong>{info.shopName}</strong>.</div>
        </div></div>
        <SignIn allowSignUp startWithSignUp initialEmail={info.email} />
      </div>
    );
  }
  return <CreateShop pilotToken={token} initialShop={info.shopName} initialName={info.contactName} />;
}

export function CreateShop({ pilotToken, initialShop = '', initialName = '' }: { pilotToken?: string; initialShop?: string; initialName?: string }) {
  const [shop, setShop] = useState(initialShop);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  return (
    <div className="phone">
      <form className="body" style={{ gap: 16, paddingTop: 32 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await actions.createShop(shop.trim(), name.trim(), pilotToken); go('/'); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
      }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Set up your shop</h1>
        <p className="muted" style={{ margin: 0 }}>You'll be the owner. You can invite your technicians and advisors next. The shop starts with the standard multi-point template and rating rules; you can change both in Settings.</p>
        <div className="field"><label htmlFor="sn">Shop name</label><input id="sn" className="input" required value={shop} onChange={(e) => setShop(e.target.value)} /></div>
        <div className="field"><label htmlFor="yn">Your name</label><input id="yn" className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create shop'}</button>
        <div className="card pad small">Joining someone else's shop? Ask the owner for an invite link and open it on this device.</div>
        <button type="button" className="linkbtn" style={{ textAlign: 'left' }} onClick={() => void actions.signOut()}>Sign out</button>
      </form>
    </div>
  );
}

export function Join({ token }: { token: string }) {
  const session = useStore((s) => s.session);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPendingLink({ kind: 'join', token }); }, [token]);
  if (!session) {
    return (
      <div>
        <div className="phone" style={{ minHeight: 0 }}><div className="body" style={{ paddingBottom: 0 }}><div className="card pad">You've been invited to a shop on Wrynch. Sign in or create an account to accept.</div></div></div>
        <SignIn allowSignUp />
      </div>
    );
  }
  return (
    <div className="phone">
      <form className="body" style={{ gap: 16, paddingTop: 32 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await actions.acceptInvite(token, name.trim()); toast('You joined the shop'); go('/'); } catch (err) {
          toast(errText(err), 'error');
          if (/no longer valid|expired/i.test(errText(err))) { setPendingLink(null); go('/'); }
        } finally { setBusy(false); }
      }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Join the shop</h1>
        <div className="field"><label htmlFor="jn">Your name (shown on inspections)</label><input id="jn" className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn primary" disabled={busy}>Accept invite</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ new inspection
const BLANK_CONFIG: VehicleConfig = { ...VEHICLES[0].config, powertrain: 'gasoline', drivetrain: 'fwd', frontSuspension: 'strut', rearSprings: 'coil',
  frontCvAxles: true, independentRearDrive: false, frontDiff: false, rearDiff: false, transferCase: false, solidAxle: false, twoPieceDriveshaft: false,
  hydraulicSteering: false, fogLamps: false, rearWiper: false, timing: 'chain', chargePort: null };

export function NewInspection() {
  const [vin, setVin] = useState('');
  const [v, setV] = useState({ year: '', make: '', model: '', trim: '', engine: '' });
  const [config, setConfig] = useState<VehicleConfig>(BLANK_CONFIG);
  const [c, setC] = useState({ name: '', phone: '', email: '' });
  const [ro, setRo] = useState('');
  const [odo, setOdo] = useState('');
  const [concerns, setConcerns] = useState('');
  const [decoded, setDecoded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vinOk = /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
  const decode = async () => {
    setBusy(true);
    try {
      const d = await actions.decodeVin(vin.trim());
      setV({ year: d.year ? String(d.year) : '', make: d.make, model: d.model, trim: d.trim, engine: d.engine });
      setConfig(d.config);
      setDecoded(`${d.year ?? ''} ${d.make} ${d.model}`.trim());
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const id = await actions.createInspection({
        vin: vin.trim().toUpperCase(), year: Number(v.year) || null, make: v.make.trim(), model: v.model.trim(), trim: v.trim.trim(), engine: v.engine.trim(), config,
        customerName: c.name, customerPhone: c.phone, customerEmail: c.email, ro, odometer: Number(odo.replace(/\D/g, '')) || null,
        concerns: concerns.split('\n').map((x) => x.trim()).filter(Boolean),
      });
      go(`/setup/${id}`);
    } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="phone">
      <TopBar title="New inspection" back="#/jobs" />
      <TekmetricPull />
      <form className="body" onSubmit={create}>
        <div className="card pad stack">
          <div className="field"><label htmlFor="vin">VIN</label>
            <div className="row">
              <input id="vin" className="input mono" autoCapitalize="characters" maxLength={17} required value={vin} onChange={(e) => { setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setDecoded(null); }} />
              {isLive() && <button type="button" className="btn sm secondary" disabled={!vinOk || busy} onClick={decode}>Look up</button>}
            </div>
          </div>
          {decoded && <span className="small" style={{ color: 'var(--ok)' }}><Icon name="check" size={14} /> Decoded: {decoded}. Check the vehicle setup on the next screen.</span>}
          {!isLive() && <span className="small muted">VIN lookup works when the app is connected to its server. Enter the vehicle below.</span>}
          <div className="grid" style={{ gridTemplateColumns: '90px 1fr 1fr' }}>
            <div className="field"><label htmlFor="yr">Year</label><input id="yr" className="input" inputMode="numeric" value={v.year} onChange={(e) => setV({ ...v, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div>
            <div className="field"><label htmlFor="mk">Make</label><input id="mk" className="input" required value={v.make} onChange={(e) => setV({ ...v, make: e.target.value })} /></div>
            <div className="field"><label htmlFor="md">Model</label><input id="md" className="input" required value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="tr">Trim</label><input id="tr" className="input" value={v.trim} onChange={(e) => setV({ ...v, trim: e.target.value })} /></div>
            <div className="field"><label htmlFor="en">Engine</label><input id="en" className="input" value={v.engine} onChange={(e) => setV({ ...v, engine: e.target.value })} /></div>
          </div>
        </div>
        <div className="card pad stack">
          <div className="field"><label htmlFor="cn">Customer name</label><input id="cn" className="input" autoComplete="off" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="cp">Mobile</label><input id="cp" className="input" type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce">Email</label><input id="ce" className="input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
          </div>
        </div>
        <div className="card pad stack">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="ro">RO number</label><input id="ro" className="input mono" value={ro} onChange={(e) => setRo(e.target.value)} /></div>
            <div className="field"><label htmlFor="od">Odometer (mi)</label><input id="od" className="input mono" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^\d,]/g, ''))} /></div>
          </div>
          <div className="field"><label htmlFor="cc">Customer concerns (one per line)</label><textarea id="cc" className="input" rows={2} value={concerns} onChange={(e) => setConcerns(e.target.value)} /></div>
        </div>
        <button className="btn primary" disabled={busy || !vin.trim() || !v.make.trim() || !v.model.trim()}>{busy ? 'One moment…' : 'Create and set up vehicle'}</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ settings
export function Settings() {
  const role = useStore((s) => s.workspace?.role);
  const shop = useStore((s) => s.workspace?.shop);
  const email = useStore((s) => s.session?.email);
  const style = useStore(() => noteStyle());
  const canSetStyle = role === 'owner' || !isLive();
  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 760 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Settings</h1>
      <section className="card pad stack" aria-labelledby="note-style-h">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <h2 id="note-style-h" className="h2" style={{ margin: 0 }}>Automatic notes</h2>
            <div className="small muted">When an inspection is finished, AI rewords technician notes and drafts blank ones from confirmed ratings and photos. Technicians approve every note.</div>
          </div>
          <div className="seg" role="group" aria-label="Automatic note style">
            {(Object.keys(NOTE_STYLES) as NoteStyle[]).map((k) => (
              <button key={k} aria-pressed={style === k} disabled={!canSetStyle} onClick={() => { if (k !== style) void actions.setNoteStyle(k); }}>{NOTE_STYLES[k]}</button>
            ))}
          </div>
        </div>
        <div className="small muted">{style === 'customer' ? 'Plain, everyday language written for the vehicle owner.' : 'Concise shop terminology for the advisor and knowledgeable customers.'}{!canSetStyle && ' Only the shop owner can change this.'}</div>
      </section>
      <AiKeyCard />
      <TrainingShareCard />
      <TekmetricCard />
      <div className="card list">
        {(role === 'owner' || !isLive()) && <a className="item" href="#/settings/team"><div className="grow"><div className="t">Team</div><div className="d">Invite technicians and advisors; change roles</div></div><Icon name="next" /></a>}
        <a className="item" href="#/settings/template"><div className="grow"><div className="t">Inspection template</div><div className="d">Stages, points and the parts behind each point</div></div><Icon name="next" /></a>
        <a className="item" href="#/settings/components"><div className="grow"><div className="t">Component checks</div><div className="d">Turn off checks your shop doesn’t do</div></div><Icon name="next" /></a>
        <a className="item" href="#/rules"><div className="grow"><div className="t">Rating rules</div><div className="d">What OK, Monitor and Immediate mean for measured checks</div></div><Icon name="next" /></a>
      </div>
      {isLive() && (
        <div className="card pad stack">
          <div className="row between"><span className="muted">Shop</span><strong>{shop?.name}</strong></div>
          <div className="row between"><span className="muted">Signed in as</span><span>{email} · {role}</span></div>
          <div className="row"><a className="btn quiet sm" href="#/account/password">Change password</a><button className="btn quiet sm" onClick={() => void actions.signOut()}>Sign out</button></div>
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', advisor: 'Advisor', technician: 'Technician' };
export function Team() {
  const ws = useStore((s) => s.workspace);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('technician');
  const [busy, setBusy] = useState(false);
  if (!isLive()) return <div className="wide"><h1 className="display" style={{ fontSize: 36 }}>Team</h1><p className="muted">Team members, invites and roles work once the app is connected to its server.</p></div>;
  if (!ws) return null;
  const linkFor = (token: string) => `${window.location.origin}${window.location.pathname}#/join/${token}`;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Invite link copied'); } catch { toast('Select the link and copy it'); } };
  const isOwner = ws.role === 'owner';
  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 860 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Team</h1>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th /></tr></thead>
          <tbody>
            {ws.members.map((m) => (
              <tr key={m.userId}>
                <td><a href={`#/profile/${m.userId}`}>{m.name}</a>{m.userId === ws.me?.userId ? ' (you)' : ''}</td>
                <td>{isOwner ? (
                  <select className="input" aria-label={`Role for ${m.name}`} style={{ height: 38, width: 160 }} value={m.role} onChange={(e) => void actions.setMemberRole(m.userId, e.target.value as Role)}>
                    {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>) : ROLE_LABEL[m.role]}</td>
                <td>{isOwner && m.userId !== ws.me?.userId && <button className="linkbtn" style={{ color: 'var(--imm)' }} onClick={() => void actions.setMemberRole(m.userId, null)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <form className="card pad stack" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { const t = await actions.invite(email.trim(), role); setEmail(''); void copy(linkFor(t)); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
        }}>
          <h2 className="h2">Invite someone</h2>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="sr" htmlFor="ie">Email</label>
            <input id="ie" className="input grow" type="email" placeholder="name@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 220 }} />
            <label className="sr" htmlFor="ir">Role</label>
            <select id="ir" className="input" style={{ width: 160 }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn primary sm" disabled={busy}>Create invite link</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Send them the link however you like. It works once and expires after 14 days. Technicians inspect; advisors also price work and send reports; owners also manage the team, template and rules.</p>
        </form>
      )}
      {ws.invites.length > 0 && (
        <div className="card pad stack">
          <h2 className="h2">Waiting to join</h2>
          {ws.invites.map((i) => (
            <div key={i.token} className="row between" style={{ flexWrap: 'wrap' }}>
              <span>{i.email} · {ROLE_LABEL[i.role]}</span>
              <button className="linkbtn" onClick={() => copy(linkFor(i.token))}>Copy link</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ template editor
const CONDITION_LABEL: Record<string, string> = {
  always: 'Always', combustion: 'Has an engine', gasoline: 'Gasoline engine', electrified: 'Hybrid or EV', plugIn: 'Plug-in or EV',
  evFrontMotor: 'EV with front motor', evRearMotor: 'EV with rear motor', rearDisc: 'Rear disc brakes', rearDrum: 'Rear drum brakes',
  rack: 'Rack-and-pinion', recirc: 'Steering gearbox', parallelogram: 'Parallelogram linkage', frontStruts: 'Front struts', frontShocks: 'Front shocks',
  rearShocks: 'Rear shocks', rearStruts: 'Rear struts', coilSprings: 'Rear coil springs', rearLeaf: 'Rear leaf springs', fwdOrAwd: 'Front CV axles',
  independentRearDrive: 'Rear CV axles', rwdAwd4wd: 'RWD, AWD or 4WD', frontDiff: 'Front differential', rearDiff: 'Rear differential',
  transferCase: 'Transfer case', twoPieceDriveshaft: 'Two-piece driveshaft', solidAxle: 'Solid rear axle', automatic: 'Automatic transmission',
  manual: 'Manual transmission', hydraulicSteering: 'Hydraulic power steering', timingBelt: 'Timing belt', timingChain: 'Timing chain',
  fogLamps: 'Fog lamps', rearWiper: 'Rear wiper', cabinFilter: 'Cabin filter', fuelFilter: 'Serviceable fuel filter', onDemand: 'Only when added by the tech',
};
const condLabel = (c: string) => CONDITION_LABEL[c] ?? (c.startsWith('chargePort:') ? `Charge port at ${positionLabel(c.slice(11))}` : c);

export function TemplateEditor() {
  const role = useStore((s) => s.workspace?.role);
  useStore((s) => s.workspace?.template?.version);
  const canEdit = !isLive() || role === 'owner';
  const [t, setT] = useState<Template>(() => structuredClone(currentTemplate()));
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // The order before "Optimize order", for Undo; cleared by any other edit.
  const [undo, setUndo] = useState<{ before: Template; wasDirty: boolean; moved: number; stagesMoved: boolean } | null>(null);
  const change = (fn_: (x: Template) => void) => { const n = structuredClone(t); fn_(n); setT(n); setDirty(true); setUndo(null); };
  const optimize = () => {
    const r = optimizeOrder(t);
    if (!r.moved && !r.stagesMoved) { toast('This template is already in working order.'); return; }
    setUndo({ before: t, wasDirty: dirty, moved: r.moved, stagesMoved: r.stagesMoved });
    setT(r.template); setDirty(true); setOpen(null);
  };
  const conditions = useMemo(() => [...Object.keys(CONDITIONS), ...['left_front', 'right_front', 'left_rear', 'right_rear', 'front', 'rear'].map((p) => `chargePort:${p}`)], []);
  const counts = t.sections.reduce((a, s) => a + s.points.length, 0);
  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 1040 }}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{t.name}</h1>
          <div className="muted">{t.sections.length} stages · {counts} points. Saving creates a new version; inspections already started keep theirs.</div>
        </div>
        {canEdit && (
          <div className="row">
            <button className="btn quiet sm" onClick={() => { setT(structuredClone(DEFAULT_TEMPLATE)); setDirty(true); setUndo(null); }}>Start from the standard template</button>
            <button className="btn quiet sm" onClick={optimize} title="Reorder points so a technician works around the car in one pass">Optimize order</button>
            <button className="btn primary sm" disabled={!dirty || saving} onClick={async () => {
              setSaving(true);
              try { await actions.saveTemplate(t); setDirty(false); } catch (e) { toast(errText(e), 'error'); } finally { setSaving(false); }
            }}>{saving ? 'Saving…' : 'Save template'}</button>
          </div>
        )}
      </div>
      {!canEdit && <div className="card pad small">Only the shop owner can change the template.</div>}
      {undo && (
        <div className="card pad row between" role="status" style={{ flexWrap: 'wrap', gap: 10, borderColor: 'var(--blue)' }}>
          <div className="stack" style={{ gap: 4, flex: '1 1 420px' }}>
            <strong>Reordered {undo.moved} point{undo.moved === 1 ? '' : 's'}{undo.stagesMoved ? ' and the stages' : ''} for one pass around the car.</strong>
            <span className="small muted">
              Order: {PHASES.join(' → ')}. The walk-around and wheels go clockwise from the driver’s door; underneath goes front to back.
              Points stay in their stages. Review it, then save the template.
            </span>
          </div>
          <button className="btn quiet sm" onClick={() => { setT(undo.before); setDirty(undo.wasDirty); setUndo(null); }}>Undo</button>
        </div>
      )}
      {t.sections.map((s, si) => (
        <section key={s.id} className="card">
          <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)', background: 'var(--card2)', borderRadius: '14px 14px 0 0' }}>
            <label className="sr" htmlFor={`sec-${s.id}`}>Stage name</label>
            <input id={`sec-${s.id}`} className="input grow" style={{ fontWeight: 700, height: 40 }} value={s.name} disabled={!canEdit} onChange={(e) => change((x) => { x.sections[si].name = e.target.value; })} />
            {canEdit && <button className="linkbtn" onClick={() => change((x) => { x.sections[si].points.push({ id: `P${Date.now().toString(36)}`, name: 'New point', note: null, components: [] }); })}>+ Point</button>}
          </div>
          <div className="list">
            {s.points.map((p, pi) => {
              const isOpen = open === p.id;
              return (
                <div key={p.id}>
                  <div className="item">
                    <button className="iconbtn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} parts for ${p.name}`} onClick={() => setOpen(isOpen ? null : p.id)}>
                      <Icon name={isOpen ? 'down' : 'next'} />
                    </button>
                    <label className="sr" htmlFor={`pt-${p.id}`}>Point name</label>
                    <input id={`pt-${p.id}`} className="input grow" style={{ height: 40 }} value={p.name} disabled={!canEdit} onChange={(e) => change((x) => { x.sections[si].points[pi].name = e.target.value; })} />
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{p.components.length} parts</span>
                    {canEdit && (
                      <>
                        <button className="iconbtn" aria-label="Move up" disabled={pi === 0} onClick={() => change((x) => { const a = x.sections[si].points; [a[pi - 1], a[pi]] = [a[pi], a[pi - 1]]; })}>↑</button>
                        <button className="iconbtn" aria-label={`Delete ${p.name}`} onClick={() => change((x) => { x.sections[si].points.splice(pi, 1); })}><Icon name="trash" /></button>
                      </>
                    )}
                  </div>
                  {isOpen && <PointParts comps={p.components} canEdit={canEdit} conditions={conditions}
                    onChange={(comps) => change((x) => { x.sections[si].points[pi].components = comps; })} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {canEdit && <button className="btn quiet" onClick={() => change((x) => { x.sections.push({ id: `stage_${Date.now().toString(36)}`, name: 'New stage', points: [] }); })}>+ Add stage</button>}
    </div>
  );
}

function PointParts({ comps, canEdit, conditions, onChange }: { comps: TemplateComponent[]; canEdit: boolean; conditions: string[]; onChange: (c: TemplateComponent[]) => void }) {
  const [q, setQ] = useState('');
  const matches = q.trim().length < 2 ? [] : ONTOLOGY.classes.filter((c) => `${c.label} ${c.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const set = (i: number, patch: Partial<TemplateComponent>) => onChange(comps.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div style={{ padding: '4px 14px 14px 58px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {comps.length === 0 && <span className="small muted">No parts: this point records a symptom (like a noise) rather than a part.</span>}
      {comps.map((c, i) => {
        const k = cls(c.classId);
        return (
          <div key={i} className="row" style={{ flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--line2)', paddingBottom: 8 }}>
            <strong style={{ minWidth: 180 }}>{compLabel(`${c.classId}@${c.position ?? ''}`)}</strong>
            {k.positions.length > 0 && (
              <select className="input" aria-label="Position" style={{ width: 150, height: 38 }} disabled={!canEdit} value={c.position ?? ''} onChange={(e) => set(i, { position: e.target.value || null })}>
                <option value="">No position</option>
                {k.positions.map((p) => <option key={p} value={p}>{positionLabel(p)}</option>)}
              </select>
            )}
            <select className="input" aria-label="Applies when" style={{ width: 220, height: 38 }} disabled={!canEdit} value={c.when} onChange={(e) => set(i, { when: e.target.value })}>
              {conditions.map((w) => <option key={w} value={w}>{condLabel(w)}</option>)}
            </select>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={c.required} disabled={!canEdit} onChange={(e) => set(i, { required: e.target.checked })} />Required</label>
            {canEdit && <button className="linkbtn" style={{ color: 'var(--imm)' }} onClick={() => onChange(comps.filter((_, x) => x !== i))}>Remove</button>}
          </div>
        );
      })}
      {canEdit && (
        <div className="stack" style={{ gap: 6 }}>
          <label className="sr" htmlFor="addpart">Add a part</label>
          <input id="addpart" className="input" placeholder={`Add a part from the catalog (${ONTOLOGY.classes.length} parts): type 2+ letters`} value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.map((m) => (
            <button key={m.id} className="item card" onClick={() => { onChange([...comps, { classId: m.id, position: m.positions[0] ?? null, required: false, when: 'always' }]); setQ(''); }}>
              <span className="grow t">{m.label}</span><span className="small muted">{m.category.replace(/_/g, ' ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
