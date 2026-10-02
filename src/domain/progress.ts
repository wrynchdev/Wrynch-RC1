// How far an inspection has got, per point and per stage. Shared by the web app and the iOS app.
import { point as getPoint, pointComponents, sections } from './ontology';
import { componentState, isPendingAi, pointState } from './rating';
import type { Inspection, Vehicle } from './types';

/** Stages with something to do on this vehicle (the EV stage disappears on a gas car). */
export function visibleSections(vehicle: Vehicle) {
  return sections().filter((s) => s.points.some((p) => p.components.length === 0 || pointComponents(p, vehicle.config).some((c) => c.applies)));
}

/** Status of one template point on this inspection. */
export function pointStatus(insp: Inspection, vehicle: Vehicle, pointId: string) {
  const comps = pointComponents(getPoint(pointId), vehicle.config).filter((c) => c.applies);
  const keys = comps.map((c) => c.key);
  const states = keys.map((k) => componentState(insp, k));
  const requiredUnrated = comps.filter((c) => c.required && componentState(insp, c.key) === 'unrated').length;
  const anyRated = states.some((s) => s !== 'unrated');
  const pendingFindings = insp.findings.filter((f) => isPendingAi(f) && keys.includes(f.compKey)).length;
  // A photo belongs to every point whose parts it shows.
  const shown = insp.media.filter((m) => !m.excluded && m.links.some((l) => keys.includes(l.compKey)));
  const pendingPhotos = shown.filter((m) => m.links.some((l) => l.status === 'ai_proposed' && keys.includes(l.compKey))).length;
  const photos = shown.length;
  const pendingOk = insp.observations.filter((o) => o.status === 'pending' && keys.includes(o.compKey)
    && componentState(insp, o.compKey) === 'unrated').length;
  // A point with no parts (e.g. "Noise, vibration or pulling") is a symptom check and never blocks.
  const done = comps.length === 0 || (requiredUnrated === 0 && (comps.some((c) => c.required) || anyRated));
  return { keys, state: pointState(insp, keys), done, pendingFindings, pendingPhotos, pendingOk, photos, count: keys.length };
}
