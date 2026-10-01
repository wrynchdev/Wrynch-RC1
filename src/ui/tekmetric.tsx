// Tekmetric: connect the shop (Settings), pull a repair order (New inspection), export after review (advisor).
import { useEffect, useState } from 'react';
import { actions, isLive, toast, useStore } from '../state/store';
import { go } from './hooks';
import { fmtDate, Icon, Sheet } from './kit';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); toast(`${what} copied`); } catch { toast('Select the text and copy it'); } };

export function TekmetricCard() {
  const role = useStore((s) => s.workspace?.role);
  const link = useStore((s) => s.tekmetric);
  const server = useStore((s) => s.ai?.tekmetric);
  const [shopId, setShopId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [ro, setRo] = useState('');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState(false);
  useEffect(() => { void actions.loadTekmetric(); }, []);
  // Show the saved values once they arrive, unless the owner already started typing.
  useEffect(() => {
    if (!link || typed) return;
    setShopId(link.tekmetricShopId ? String(link.tekmetricShopId) : '');
    setEnabled(link.enabled || !link.linked);
  }, [link?.tekmetricShopId, link?.enabled, link?.linked]);
  const owner = role === 'owner';
  const hook = link?.webhookToken ? `${window.location.origin}/api/tekmetric-webhook?token=${link.webhookToken}` : '';
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); } };
  return (
    <section className="card pad stack" aria-labelledby="tm-h">
      <div>
        <h2 id="tm-h" className="h2" style={{ margin: 0 }}>Tekmetric</h2>
        <div className="small muted">New repair orders in Tekmetric become Wrynch inspections with the RO number, vehicle, customer and technician. After review, advisors export the results back to the repair order. Part conditions and history stay in Wrynch.</div>
      </div>
      {!isLive() ? <p className="small muted" style={{ margin: 0 }}>Tekmetric works once the app is connected to its server.</p> : (
        <>
          {server === false && (
            <div className="small" style={{ color: 'var(--mon)', border: '1px dashed var(--mon)', borderRadius: 12, padding: '10px 12px' }}>Wrynch’s Tekmetric API access isn’t switched on yet. You can link your shop now; notifications from Tekmetric are recorded and imports start once access is on.</div>
          )}
          {owner ? (
            <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await actions.saveTekmetric(Number(shopId) || null, enabled); setTyped(false); }); }}>
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field grow" style={{ minWidth: 180 }}><label htmlFor="tm-shop">Tekmetric shop ID</label>
                  <input id="tm-shop" className="input mono" inputMode="numeric" value={shopId} onChange={(e) => { setTyped(true); setShopId(e.target.value.replace(/\D/g, '')); }} placeholder="e.g. 238" /></div>
                <label className="row small" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={enabled} onChange={(e) => { setTyped(true); setEnabled(e.target.checked); }} style={{ width: 20, height: 20 }} />Sync on</label>
                <button className="btn primary" disabled={busy || !shopId}>Save</button>
                {link?.linked && <button type="button" className="btn quiet" disabled={busy} onClick={() => void run(async () => { await actions.saveTekmetric(null, false); setTyped(false); })}>Disconnect</button>}
              </div>
              {hook && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="small">In Tekmetric, add a webhook (Settings → Integrations) with this address and turn on the <b>Repair Order: Create</b> event:</span>
                  <div className="row"><input className="input mono small grow" readOnly value={hook} aria-label="Webhook address" onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn sm secondary" onClick={() => void copy(hook, 'Webhook address')}>Copy</button></div>
                  <span className="small muted">Keep this address private: anyone with it can ask Wrynch to import your repair orders.</span>
                </div>
              )}
            </form>
          ) : (
            <p className="small" style={{ margin: 0 }}>{link?.linked ? `Connected to Tekmetric shop ${link.tekmetricShopId}${link.enabled ? '' : ' (sync off)'}.` : 'Not connected. The shop owner connects Tekmetric here.'}</p>
          )}
          {link?.linked && link.enabled && (
            <form className="row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void run(async () => { const id = await actions.importTekmetricRo(ro); setRo(''); go(`/setup/${id}`); }); }}>
              <div className="field grow" style={{ minWidth: 160 }}><label htmlFor="tm-ro">Pull a repair order by number</label>
                <input id="tm-ro" className="input mono" value={ro} onChange={(e) => setRo(e.target.value)} placeholder="RO #" /></div>
              <button className="btn secondary" style={{ alignSelf: 'flex-end' }} disabled={busy || !ro.trim()}>Pull from Tekmetric</button>
            </form>
          )}
          {link && link.events.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Recent activity</span>
              <div className="list small">
                {link.events.map((e, k) => (
                  <div key={k} className="item" style={{ minHeight: 0, padding: '8px 0' }}>
                    <span className={`chip ${e.status === 'ok' ? 'ok' : e.status === 'error' ? 'immediate' : 'na'}`}>{e.kind}</span>
                    <span className="grow">{e.detail}</span>
                    <span className="muted">{fmtDate(e.at.slice(0, 10))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** New inspection screen: start from a Tekmetric repair order instead of typing the vehicle in. */
export function TekmetricPull() {
  const link = useStore((s) => s.tekmetric);
  const [ro, setRo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isLive()) void actions.loadTekmetric(); }, []);
  if (!isLive() || !link?.linked || !link.enabled) return null;
  return (
    <form className="body" style={{ paddingBottom: 0 }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { const id = await actions.importTekmetricRo(ro); go(`/setup/${id}`); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
    }}>
      <div className="card pad stack" style={{ gap: 10 }}>
        <strong>Start from a Tekmetric repair order</strong>
        <div className="row">
          <input className="input mono grow" aria-label="Tekmetric RO number" placeholder="RO #" value={ro} onChange={(e) => setRo(e.target.value)} />
          <button className="btn secondary" disabled={busy || !ro.trim()}>{busy ? 'Pulling…' : 'Pull'}</button>
        </div>
        <span className="small muted">Or enter the vehicle below.</span>
      </div>
    </form>
  );
}

/** Advisor results: export the reviewed inspection back to its Tekmetric repair order. */
export function TekmetricExportButton({ inspId, status }: { inspId: string; status: string }) {
  const [ro, setRo] = useState<{ roId: number | null; exportedAt: string | null } | null>(null);
  const [out, setOut] = useState<{ written: boolean; reason?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isLive()) actions.tekmetricRoOf(inspId).then(setRo).catch(() => setRo(null)); }, [inspId]);
  if (!ro?.roId || (status !== 'submitted' && status !== 'sent')) return null;
  return (
    <>
      <button className="btn secondary sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try { setOut(await actions.exportTekmetric(inspId)); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
      }}><Icon name="send" size={16} />{busy ? 'Exporting…' : ro.exportedAt ? 'Export to Tekmetric again' : 'Export to Tekmetric'}</button>
      {out && (
        <Sheet title={out.written ? 'Exported to Tekmetric' : 'Ready for Tekmetric'} onClose={() => setOut(null)}>
          {!out.written && <p className="small" style={{ margin: 0 }}>{out.reason}</p>}
          <textarea className="input mono small" rows={14} readOnly value={out.text} aria-label="Export for Tekmetric" onFocus={(e) => e.target.select()} />
          <span className="small muted">Approved customer notes by inspection point, photo counts, the estimate with the customer’s decisions, and the report link (where the photos are). Part conditions and history stay in Wrynch.</span>
          <div className="row">
            <button className="btn primary grow" onClick={() => void copy(out.text, 'Export')}>Copy for Tekmetric</button>
            <button className="btn quiet" onClick={() => setOut(null)}>Close</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
