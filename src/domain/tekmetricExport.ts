// What Wrynch sends back to a Tekmetric repair order after the advisor's review: each inspection point's rating and
// approved customer note, how many confirmed photos it has, the customer's approvals, and the report link (where the
// photos live). Component conditions and history stay in Wrynch. Only approved, technician-confirmed content is used.
import { compLabel, pointComponents } from './ontology';
import { linkConfirmed, pointState } from './rating';
import type { ComponentState, Inspection, Template, Vehicle } from './types';

export interface ExportPoint { pointId: string; stage: string; point: string; rating: ComponentState; note: string; photos: number }
/** `approved` is null for general lines (diagnosis, supplies) that aren't tied to a part the customer approves. */
export interface ExportLine { part: string; description: string; amount: number; approved: boolean | null }
export interface TekmetricExport { roNumber: string; reportUrl: string; points: ExportPoint[]; lines: ExportLine[]; text: string }

const RATING_WORD: Partial<Record<ComponentState, string>> = { immediate: 'Needs attention now', monitor: 'Monitor', ok: 'OK', not_inspected: 'Not checked', unable_to_assess: 'Not checked' };
const money = (n: number) => `$${n.toFixed(2)}`;

/** The note the customer sees for a point: an approved or edited AI note, or the technician's own words. */
export function customerNote(insp: Inspection, pointId: string): string {
  const n = insp.notes.find((x) => x.pointId === pointId);
  if (!n || n.status === 'ai_suggested') return n?.techText.trim() ?? '';
  return (n.customerText ?? n.techText ?? '').trim();
}

export function buildTekmetricExport(insp: Inspection, vehicle: Vehicle, template: Template, reportUrl: string): TekmetricExport {
  const points: ExportPoint[] = [];
  for (const s of template.sections) {
    for (const p of s.points) {
      const keys = pointComponents(p, vehicle.config).filter((c) => c.applies).map((c) => c.key);
      if (!keys.length) continue;
      const rating = pointState(insp, keys);
      const note = customerNote(insp, p.id);
      const photos = insp.media.filter((m) => !m.excluded && m.customerVisible && m.links.some((l) => keys.includes(l.compKey) && linkConfirmed(m, l.compKey))).length;
      if (rating === 'unrated' && !note) continue;
      points.push({ pointId: p.id, stage: s.name, point: p.name, rating, note, photos });
    }
  }
  const approved = new Set(insp.customerApprovals);
  const lines = insp.estimate.map((e) => ({
    part: e.compKey ? compLabel(e.compKey) : '', description: e.description, amount: e.parts + e.labor,
    approved: e.compKey ? approved.has(e.compKey) : null,
  }));

  const head = `Wrynch inspection · RO ${insp.ro || '—'} · ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;
  const block = (title: string, list: ExportPoint[]) => (list.length ? [``, title.toUpperCase(), ...list.map((p) => `- ${p.point}${p.note ? `: ${p.note}` : ''}${p.photos ? ` [${p.photos} photo${p.photos === 1 ? '' : 's'}]` : ''}`)] : []);
  const text = [
    head,
    `Report with photos: ${reportUrl}`,
    ...block(RATING_WORD.immediate!, points.filter((p) => p.rating === 'immediate')),
    ...block(RATING_WORD.monitor!, points.filter((p) => p.rating === 'monitor')),
    ...block('Not checked', points.filter((p) => p.rating === 'not_inspected' || p.rating === 'unable_to_assess')),
    ...block(RATING_WORD.ok!, points.filter((p) => p.rating === 'ok')),
    ...(lines.length ? ['', 'ESTIMATE', ...lines.map((l) => `- ${l.description}${l.part ? ` (${l.part})` : ''}: ${money(l.amount)} · ${l.approved === null ? 'shop line' : l.approved ? 'approved by customer' : 'not approved'}`)] : []),
  ].join('\n');
  return { roNumber: insp.ro, reportUrl, points, lines, text };
}
