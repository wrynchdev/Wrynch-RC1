// Tekmetric API client (fetch only). Wrynch connects as one Tekmetric partner app: its client id and secret are
// server environment variables, and each shop links the Tekmetric shop id it authorized for Wrynch.
//
// What Tekmetric's API offers (read access to shops, repair orders, vehicles, customers, employees and jobs;
// OAuth 2 client credentials) is used here. Its API has no inspection endpoints, so Wrynch can't write to
// Tekmetric's inspection points or attach photos to them; the export sends a summary instead (see tekmetricExport.ts).
// Field names on Tekmetric's records are read tolerantly, because Tekmetric only shows its reference to approved
// developers: anything missing is simply left blank.
import { env, HttpError } from './lib';
import { mapVpic, decodeVin } from './vin';
import type { VehicleConfig } from '../src/domain/types';

export const tekmetricConfigured = () => !!(env('TEKMETRIC_CLIENT_ID') && env('TEKMETRIC_CLIENT_SECRET'));
// TEKMETRIC_BASE_URL is only for the browser test's stand-in Tekmetric.
const base = () => env('TEKMETRIC_BASE_URL') || (env('TEKMETRIC_ENV') === 'production' ? 'https://shop.tekmetric.com' : 'https://sandbox.tekmetric.com');

let cached: { token: string; until: number; base: string } | null = null;
export function resetTekmetricToken() { cached = null; }

async function token(): Promise<string> {
  if (!tekmetricConfigured()) throw new HttpError(503, 'Tekmetric isn’t connected on the server yet (API credentials missing).');
  if (cached && cached.base === base() && cached.until > Date.now() + 60_000) return cached.token;
  const basic = btoa(`${env('TEKMETRIC_CLIENT_ID')}:${env('TEKMETRIC_CLIENT_SECRET')}`);
  const r = await fetch(`${base()}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new HttpError(502, `Tekmetric sign-in failed (${r.status}). Check the Tekmetric API credentials.`);
  const body = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new HttpError(502, 'Tekmetric sign-in returned no token.');
  cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000, base: base() };
  return cached.token;
}

type Rec = Record<string, unknown>;
async function get(path: string, params: Record<string, string | number> = {}): Promise<Rec | null> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const r = await fetch(`${base()}/api/v1${path}${q ? `?${q}` : ''}`, { headers: { authorization: `Bearer ${await token()}`, accept: 'application/json' } });
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new HttpError(502, 'Tekmetric refused access. Check that this shop authorized Wrynch in Tekmetric.');
  if (!r.ok) throw new HttpError(502, `Tekmetric request failed (${r.status}).`);
  return (await r.json()) as Rec;
}
const firstOf = (page: Rec | null): Rec | null => {
  const list = Array.isArray(page) ? page : Array.isArray(page?.content) ? (page!.content as Rec[]) : [];
  return (list[0] as Rec) ?? null;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !isNaN(Number(v)) ? Number(v) : null);
const pick = (o: Rec | null | undefined, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const idOf = (v: unknown) => num(typeof v === 'object' && v ? (v as Rec).id : v);

/** What Wrynch needs from one repair order, in the shape `tekmetric_import_ro` takes. */
export interface RoImport {
  roId: number; roNumber: string; vin: string; year: number | null; make: string; model: string; trim: string; engine: string;
  config: VehicleConfig; customerName: string; customerPhone: string; customerEmail: string; odometer: number | null;
  technician: string; concerns: string[];
}

export function phoneOf(c: Rec | null): string {
  const p = pick(c, 'phone', 'phones', 'phoneNumber');
  if (Array.isArray(p)) { const first = p.find((x) => (x as Rec)?.primary) ?? p[0]; return str(typeof first === 'object' ? pick(first as Rec, 'number', 'phone') : first); }
  return str(p);
}
export function emailOf(c: Rec | null): string {
  const e = pick(c, 'email', 'emails', 'emailAddress');
  return Array.isArray(e) ? str(typeof e[0] === 'object' ? pick(e[0] as Rec, 'email', 'address') : e[0]) : str(e);
}
const personName = (p: Rec | null) => [str(pick(p, 'firstName')), str(pick(p, 'lastName'))].filter(Boolean).join(' ') || str(pick(p, 'name', 'fullName'));

/** Map Tekmetric records to an import. `config` comes from the VIN when it decodes, else safe defaults to check. */
export function toImport(ro: Rec, vehicle: Rec | null, customer: Rec | null, tech: Rec | null, config: VehicleConfig): RoImport {
  const concerns = pick(ro, 'customerConcerns', 'concerns');
  return {
    roId: idOf(ro.id)!,
    roNumber: str(pick(ro, 'repairOrderNumber', 'number')),
    vin: str(pick(vehicle, 'vin')).toUpperCase(),
    year: num(pick(vehicle, 'year')),
    make: str(pick(vehicle, 'make')),
    model: str(pick(vehicle, 'model')),
    trim: str(pick(vehicle, 'subModel', 'trim')),
    engine: str(pick(vehicle, 'engine')),
    config,
    customerName: personName(customer),
    customerPhone: phoneOf(customer),
    customerEmail: emailOf(customer),
    odometer: num(pick(ro, 'milesIn', 'mileageIn', 'odometer', 'mileage')) ?? num(pick(vehicle, 'mileage')),
    technician: personName(tech),
    concerns: Array.isArray(concerns) ? concerns.map((c) => str(typeof c === 'object' && c ? pick(c as Rec, 'concern', 'text', 'description') : c)).filter(Boolean) : [],
  };
}

/** Load a repair order and the records it points at, ready to import. */
export async function loadRepairOrder(tekmetricShopId: number, roId: number): Promise<RoImport> {
  const ro = await get(`/repair-orders/${roId}`, { shop: tekmetricShopId });
  if (!ro) throw new HttpError(404, `Tekmetric has no repair order ${roId} for this shop.`);
  return complete(tekmetricShopId, ro);
}
export async function findRepairOrder(tekmetricShopId: number, roNumber: string): Promise<RoImport> {
  const ro = firstOf(await get('/repair-orders', { shop: tekmetricShopId, repairOrderNumber: roNumber.trim() }));
  if (!ro) throw new HttpError(404, `No repair order #${roNumber.trim()} in Tekmetric for this shop.`);
  return complete(tekmetricShopId, ro);
}
async function complete(shop: number, ro: Rec): Promise<RoImport> {
  const vehicleId = idOf(pick(ro, 'vehicleId', 'vehicle'));
  const customerId = idOf(pick(ro, 'customerId', 'customer'));
  const techId = idOf(pick(ro, 'technicianId', 'technician'));
  const [vehicle, customer, tech] = await Promise.all([
    vehicleId ? get(`/vehicles/${vehicleId}`, { shop }) : null,
    customerId ? get(`/customers/${customerId}`, { shop }) : null,
    techId ? get(`/employees/${techId}`, { shop }) : null,
  ]);
  const vin = str(pick(vehicle, 'vin')).toUpperCase();
  let config = mapVpic(vin, {}).config;
  try { if (vin.length === 17) config = (await decodeVin(vin)).config; } catch { /* keep defaults; the tech confirms the setup */ }
  return toImport(ro, vehicle, customer, tech, config);
}

/** Pull the repair order id out of a webhook body, whatever shape it arrives in. */
export function roIdFromWebhook(body: unknown): number | null {
  const b = (body ?? {}) as Rec;
  const d = (b.data ?? b.payload ?? b.repairOrder ?? {}) as Rec;
  return idOf(pick(d, 'repairOrderId')) ?? idOf(pick(b, 'repairOrderId')) ?? idOf(pick(d as Rec, 'repairOrder'))
    ?? (/repair.?order/i.test(str(pick(b, 'event', 'type', 'eventType', 'name'))) ? idOf(pick(d, 'id')) ?? idOf(pick(b, 'id')) : null)
    ?? idOf(pick(d, 'id'));
}
export const webhookEvent = (body: unknown) => str(pick((body ?? {}) as Rec, 'event', 'type', 'eventType', 'name')) || 'event';
