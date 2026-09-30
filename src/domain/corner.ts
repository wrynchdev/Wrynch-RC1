// Corner tags for photos taken with the in-app camera: the technician says where they are standing
// (left front, right front, left rear, right rear) and the AI only considers parts that could be seen from there.
// Photos chosen from the phone's library carry no corner and are sorted as before.
import { parseKey } from './ontology';
import type { CompKey } from './types';

export const CORNERS = ['left_front', 'right_front', 'left_rear', 'right_rear'] as const;
export type Corner = (typeof CORNERS)[number];
export const CORNER_SHORT: Record<Corner, string> = { left_front: 'LF', right_front: 'RF', left_rear: 'LR', right_rear: 'RR' };
export const CORNER_LABEL: Record<Corner, string> = { left_front: 'Left front', right_front: 'Right front', left_rear: 'Left rear', right_rear: 'Right rear' };
export const isCorner = (v: unknown): v is Corner => typeof v === 'string' && (CORNERS as readonly string[]).includes(v);

/** Could a part at this position be the one in a photo taken at this corner? Whole-vehicle parts always could. */
export function positionFitsCorner(position: string | null, corner: Corner): boolean {
  if (!position || position === corner) return true;
  const [side, end] = corner.split('_');
  if (position === side || position === end) return true;            // "left" tie rod, "front" bumper
  if ((CORNERS as readonly string[]).includes(position)) return false; // another corner
  return position.startsWith(`${side}_`) || position.endsWith(`_${end}`); // left_mid, etc.
}

/** Keep only the parts that fit the corner; if none would be left, keep them all (the tag is a hint, not a wall). */
export function filterByCorner<T>(items: T[], keyOf: (x: T) => CompKey, corner: Corner | null | undefined): T[] {
  if (!corner) return items;
  const kept = items.filter((x) => positionFitsCorner(parseKey(keyOf(x)).position, corner));
  return kept.length ? kept : items;
}
