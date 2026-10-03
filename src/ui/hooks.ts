import { useEffect, useState } from 'react';
import { actions, activateTemplateFor, useStore } from '../state/store';
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

const requested = new Set<string>();
/** The inspection and its vehicle; in live mode the first use loads it from the server. */
export function useInspection(id: string): { insp: Inspection; vehicle: Vehicle } | null {
  const s = useStore((x) => x);
  const insp = s.inspections.find((i) => i.id === id);
  useEffect(() => {
    if (s.mode === 'live' && id && !requested.has(id)) { requested.add(id); void actions.loadInspection(id); }
  }, [id, s.mode]);
  if (!insp) return null;
  // Points, parts and turned-off checks come from this inspection's own template version.
  activateTemplateFor(insp);
  const vehicle = s.vehicles.find((v) => v.id === insp.vehicleId);
  return vehicle ? { insp, vehicle } : null;
}

const historyRequested = new Set<string>();
/** Make sure every visit of a vehicle is loaded (live mode). */
export function useVehicleHistory(vehicleId: string) {
  const mode = useStore((x) => x.mode);
  useEffect(() => {
    if (mode === 'live' && vehicleId && !historyRequested.has(vehicleId)) { historyRequested.add(vehicleId); void actions.loadVehicleHistory(vehicleId); }
  }, [vehicleId, mode]);
}

export { pointStatus } from '../domain/progress';
