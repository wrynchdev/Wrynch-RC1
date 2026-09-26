// VIN decoding with NHTSA's free vPIC service, mapped to the vehicle configuration that decides which parts apply.
import type { VehicleConfig } from '../src/domain/types';
import { HttpError } from './lib';

export interface Decoded {
  vin: string; year: number | null; make: string; model: string; trim: string; engine: string;
  config: VehicleConfig;
  /** Config fields the VIN actually told us; the rest are best guesses the technician should check. */
  fromVin: (keyof VehicleConfig)[];
}

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function mapVpic(vin: string, r: Record<string, string>): Decoded {
  const s = (k: string) => (r[k] ?? '').trim();
  const fromVin: (keyof VehicleConfig)[] = [];
  const drive = s('DriveType').toLowerCase();
  const body = s('BodyClass').toLowerCase();
  const elec = s('ElectrificationLevel').toLowerCase();
  const fuel = s('FuelTypePrimary').toLowerCase();
  const trans = s('TransmissionStyle').toLowerCase();

  let powertrain: VehicleConfig['powertrain'] = 'gasoline';
  if (elec.includes('bev') || (fuel === 'electric' && !elec)) { powertrain = 'ev'; fromVin.push('powertrain'); }
  else if (elec.includes('phev')) { powertrain = 'plug_in_hybrid'; fromVin.push('powertrain'); }
  else if (elec.includes('hev')) { powertrain = 'hybrid'; fromVin.push('powertrain'); }
  else if (fuel.includes('diesel')) { powertrain = 'diesel'; fromVin.push('powertrain'); }
  else if (fuel) fromVin.push('powertrain');

  let drivetrain: VehicleConfig['drivetrain'] = 'fwd';
  if (/4wd|4x4|4-wheel/.test(drive)) drivetrain = '4wd';
  else if (/awd|all-wheel/.test(drive)) drivetrain = 'awd';
  else if (/rwd|rear-wheel|4x2/.test(drive)) drivetrain = 'rwd';
  if (drive) fromVin.push('drivetrain');

  const truck = /pickup|truck|van/.test(body);
  const frameSuv = truck || drivetrain === '4wd';
  const transmission: VehicleConfig['transmission'] = /manual|standard/.test(trans) ? 'manual' : 'automatic';
  if (trans) fromVin.push('transmission');

  const ev = powertrain === 'ev';
  const config: VehicleConfig = {
    powertrain, drivetrain, transmission,
    rearBrakes: 'disc',
    steering: 'rack',
    hydraulicSteering: false,
    frontSuspension: frameSuv ? 'shock' : 'strut',
    rearSuspension: 'shock',
    rearSprings: truck ? 'leaf' : 'coil',
    frontCvAxles: drivetrain !== 'rwd',
    independentRearDrive: !truck && (drivetrain === 'awd' || (drivetrain === 'rwd' && !frameSuv)),
    frontDiff: drivetrain === '4wd',
    rearDiff: drivetrain !== 'fwd' && !ev,
    transferCase: drivetrain === '4wd',
    twoPieceDriveshaft: truck && drivetrain !== 'fwd',
    solidAxle: frameSuv && drivetrain !== 'fwd',
    timing: ev ? 'none' : 'chain',
    fogLamps: false,
    rearWiper: /suv|sport utility|wagon|hatchback|minivan/.test(body),
    cabinFilter: true,
    fuelFilter: powertrain === 'diesel',
    chargePort: powertrain === 'ev' || powertrain === 'plug_in_hybrid' ? 'left_front' : null,
  };
  const disp = s('DisplacementL');
  const cyl = s('EngineCylinders');
  const engine = ev ? 'Electric' : [disp ? `${Number(disp).toFixed(1)}L` : '', cyl ? `${cyl}-cyl` : '', s('FuelTypePrimary')].filter(Boolean).join(' ');
  return {
    vin, year: Number(s('ModelYear')) || null, make: titleCase(s('Make')), model: s('Model'), trim: s('Trim'),
    engine, config, fromVin,
  };
}

const titleCase = (x: string) => x.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export async function decodeVin(vinRaw: string): Promise<Decoded> {
  const vin = vinRaw.trim().toUpperCase();
  if (!VIN_RE.test(vin)) throw new HttpError(400, 'A VIN is 17 letters and numbers (no I, O or Q)');
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
  if (!r.ok) throw new HttpError(502, 'The VIN lookup service is unavailable; enter the vehicle by hand');
  const body = (await r.json()) as { Results?: Record<string, string>[] };
  const row = body.Results?.[0];
  if (!row || !row.Make) throw new HttpError(404, "That VIN didn't decode; check it or enter the vehicle by hand");
  return mapVpic(vin, row);
}
