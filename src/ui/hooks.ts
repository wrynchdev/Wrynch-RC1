import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { pointComponents, point as getPoint } from '../domain/ontology';
import { componentState, isPendingAi, pointState } from '../domain/rating';
import type { Inspection, Vehicle } from '../domain/types';

export function useHash(): string[] {
  const read = () => decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
export const go = (path: string) => { window.location.hash = path; };
export const enc = encodeURIComponent;

export function useInspection(id: string): { insp: Inspection; vehicle: Vehicle } | null {
  const s = useStore((x) => x);
  const insp = s.inspections.find((i) => i.id === id);
  if (!insp) return null;
  return { insp, vehicle: s.vehicles.find((v) => v.id === insp.vehicleId)! };
}

/** Status of one template point on this inspection. */
export function pointStatus(insp: Inspection, vehicle: Vehicle, pointId: string) {
  const comps = pointComponents(getPoint(pointId), vehicle.config).filter((c) => c.applies);
  const keys = comps.map((c) => c.key);
  const states = keys.map((k) => componentState(insp, k));
  const requiredUnrated = comps.filter((c) => c.required && componentState(insp, c.key) === 'unrated').length;
  const anyRated = states.some((s) => s !== 'unrated');
  const pendingFindings = insp.findings.filter((f) => isPendingAi(f) && keys.includes(f.compKey)).length;
  const pendingPhotos = insp.media.filter((m) => m.pointId === pointId && m.status === 'ai_proposed').length;
  const photos = insp.media.filter((m) => m.pointId === pointId && m.status !== 'excluded').length;
  // A point with no parts (e.g. "Noise, vibration or pulling") is a symptom check and never blocks.
  const done = comps.length === 0 || (requiredUnrated === 0 && (comps.some((c) => c.required) || anyRated));
  return { keys, state: pointState(insp, keys), done, pendingFindings, pendingPhotos, photos, count: keys.length };
}
