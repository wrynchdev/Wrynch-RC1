// Settings: a shop owner can use the shop's own AI account (Anthropic or OpenAI). The key goes straight to the
// server, which checks it with the provider and stores it encrypted; the page only ever shows the last four characters.
import { useEffect, useState, type FormEvent } from 'react';
import { actions, isLive, toast, useStore } from '../state/store';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const NAME = { anthropic: 'Anthropic', openai: 'OpenAI' } as const;

export function AiKeyCard() {
  const role = useStore((s) => s.workspace?.role);
  const info = useStore((s) => s.shopAi);
  const server = useStore((s) => s.ai);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => { void actions.loadShopAi(); }, []);
  if (!isLive()) return null;
  const owner = role === 'owner';
  const using = info?.configured
    ? `This shop uses its own ${NAME[info.provider ?? 'anthropic']} account${info.last4 ? ` (key ending ••••${info.last4}${info.model ? ` · ${info.model}` : ''})` : ''}.`
    : server?.on ? 'This shop uses Wrynch’s AI.' : 'No AI is set up for this shop yet, so photos are placed by hand.';
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await actions.saveShopAi(provider, key, model); setKey(''); setEditing(false); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); setShow(false); }
  };
  return (
    <section className="card pad stack" aria-labelledby="aik-h">
      <div>
        <h2 id="aik-h" className="h2" style={{ margin: 0 }}>AI provider</h2>
        <div className="small muted">Use your own Anthropic or OpenAI account for photo sorting and notes. Usage is billed to that account, and photos and notes for this shop are sent to that provider.</div>
      </div>
      <p className="small" style={{ margin: 0 }}>{using}</p>
      {owner && server && server.shopKeys === false && (
        <p className="small" style={{ margin: 0, color: 'var(--mon)' }}>Saving your own key isn’t switched on on the server yet.</p>
      )}
      {owner && (info?.configured && !editing ? (
        <div className="row">
          <button className="btn secondary sm" onClick={() => { setProvider(info.provider ?? 'anthropic'); setModel(info.model ?? ''); setEditing(true); }}>Replace key</button>
          <button className="btn quiet sm" disabled={busy} onClick={async () => { setBusy(true); try { await actions.removeShopAi(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); } }}>Remove</button>
        </div>
      ) : (
        <form className="stack" style={{ gap: 10 }} onSubmit={save} autoComplete="off">
          <div className="seg" role="group" aria-label="AI provider">
            {(['anthropic', 'openai'] as const).map((p) => <button key={p} type="button" aria-pressed={provider === p} onClick={() => setProvider(p)}>{NAME[p]}</button>)}
          </div>
          <div className="field"><label htmlFor="aik-key">API key</label>
            <div className="row">
              <input id="aik-key" className="input mono grow" type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)}
                autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off" data-1p-ignore="true" data-lpignore="true"
                placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'} required />
              <button type="button" className="btn sm quiet" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <div className="field"><label htmlFor="aik-model">Model{provider === 'anthropic' ? ' (optional)' : ''}</label>
            <input id="aik-model" className="input mono" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} autoCapitalize="off"
              placeholder={provider === 'anthropic' ? 'Leave blank for Wrynch’s default' : 'A model that can read photos'} required={provider === 'openai'} />
          </div>
          <span className="small muted">The key is checked with {NAME[provider]}, encrypted, and never shown again. Only shop owners can change it.</span>
          <div className="row">
            <button className="btn primary" disabled={busy || key.trim().length < 20}>{busy ? 'Checking…' : 'Check and save'}</button>
            {editing && <button type="button" className="btn quiet" onClick={() => { setEditing(false); setKey(''); }}>Cancel</button>}
          </div>
        </form>
      ))}
    </section>
  );
}
