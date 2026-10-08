// Inspection mode: the inspection takes the whole screen, moves point by point like a wizard (Back / Next), and lets the
// technician jump to any point at any time (to go back, or skip ahead and come back later).
import { useState } from 'react';
import { inspectionSteps, pointStatus } from '../domain/progress';
import type { Inspection, Vehicle } from '../domain/types';
import { AiChip, Icon, Sheet, StateChip } from './kit';
import { go } from './hooks';

// ---------------------------------------------------------------- full screen
/** Ask the browser for full screen (needs a tap). Phones that can't (iPhone Safari) still get the app's own full-screen layout. */
export function enterFullScreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  try {
    if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    else el.webkitRequestFullscreen?.();
  } catch { /* not allowed here; the layout is full screen anyway */ }
}
export function exitFullScreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

// ---------------------------------------------------------------- where the tech was
const lastPoint = new Map<string, string>();
export const rememberPoint = (inspId: string, pointId: string) => { lastPoint.set(inspId, pointId); };
export const rememberedPoint = (inspId: string) => lastPoint.get(inspId) ?? null;

// ---------------------------------------------------------------- Back / Jump / Next
export function WizardFooter({ insp, vehicle, pointId }: { insp: Inspection; vehicle: Vehicle; pointId: string }) {
  const [jumping, setJumping] = useState(false);
  const steps = inspectionSteps(vehicle);
  const idx = steps.findIndex((s) => s.pointId === pointId);
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;
  const base = `#/insp/${insp.id}`;
  return (
    <>
      <nav className="footer wizard" aria-label="Inspection steps">
        <a className="btn quiet wiz-back" href={prev ? `${base}/point/${prev.pointId}` : base} aria-label={prev ? `Back to ${prev.pointName}` : 'Back to the overview'}>
          <Icon name="back" size={26} /><span>Back</span>
        </a>
        <button type="button" className="btn quiet wiz-jump" onClick={() => setJumping(true)} aria-label={`Jump to a point (now ${idx + 1} of ${steps.length})`}>
          <Icon name="jump" size={24} /><span>{idx + 1}/{steps.length}</span>
        </button>
        <a className="btn primary wiz-next" href={next ? `${base}/point/${next.pointId}` : `${base}/finish`}>
          <span className="wiz-label"><span>{next ? 'Next' : 'Finish'}</span><small>{next ? next.pointName : 'Review and send'}</small></span>
          <Icon name="next" size={26} />
        </a>
      </nav>
      {jumping && <JumpSheet insp={insp} vehicle={vehicle} current={pointId} onClose={() => setJumping(false)} />}
    </>
  );
}

/** Every point, stage by stage, with how far each one has got. Tap one to go straight there. */
export function JumpSheet({ insp, vehicle, current, onClose }: { insp: Inspection; vehicle: Vehicle; current: string | null; onClose: () => void }) {
  const steps = inspectionSteps(vehicle);
  const stages = [...new Map(steps.map((s) => [s.stageId, s.stageName])).entries()];
  const base = `#/insp/${insp.id}`;
  const open = (href: string) => { onClose(); go(href.replace(/^#/, '')); };
  return (
    <Sheet title="Jump to a point" onClose={onClose}>
      <div className="row">
        <button className="btn quiet grow" onClick={() => open(base)}><Icon name="dashboard" />Overview</button>
        <button className="btn quiet grow" onClick={() => open(`${base}/finish`)}><Icon name="check" />Finish</button>
      </div>
      <div className="jump-list">
        {stages.map(([stageId, stageName]) => (
          <section key={stageId}>
            <h3 className="caps">{stageName}</h3>
            {steps.filter((s) => s.stageId === stageId).map((s) => {
              const st = pointStatus(insp, vehicle, s.pointId);
              const here = s.pointId === current;
              return (
                <button key={s.pointId} type="button" className={`jump-item${here ? ' here' : ''}`} aria-current={here ? 'step' : undefined}
                  onClick={() => open(`${base}/point/${s.pointId}`)}>
                  <span className={`jump-dot${st.done ? ' done' : ''}`} aria-hidden="true">{st.done ? <Icon name="check" size={18} stroke={3} /> : null}</span>
                  <span className="grow">{s.pointName}</span>
                  {st.count === 0 ? <span className="chip na">Symptom</span>
                    : st.pendingFindings > 0 ? <AiChip>{st.pendingFindings}</AiChip>
                    : <StateChip state={st.state} />}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </Sheet>
  );
}
