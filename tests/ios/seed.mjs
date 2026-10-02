// Seed the local test server for the iOS UI test: a technician (who owns a pilot shop) and one inspection to do.
//   PGURL=… MOCK=http://localhost:54329 node --import tsx tests/ios/seed.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { VEHICLES } from '../../src/domain/seed.ts';

const MOCK = process.env.MOCK ?? 'http://localhost:54329';
const q = (sql) => {
  const r = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', process.env.PGURL, '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const post = async (path, body, token) => {
  const r = await fetch(`${MOCK}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'anon', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

const email = 'tech@shop.test', password = 'wrynch-ios-1';
const session = await post('/auth/v1/signup', { email, password });
const id = q(`insert into public.pilot_request (shop_name, contact_name, email) values ('iOS Test Garage', 'Pat Lee', '${email}') returning id`);
const token = q(`select public.approve_pilot_request('${id}', 'http://localhost')`).split('/pilot/')[1];
const template = JSON.parse(readFileSync('src/data/ontology.json', 'utf8')).template;
const shop = await post('/rest/v1/rpc/create_shop', { p_name: 'iOS Test Garage', p_display_name: 'Pat Lee', p_template: template, p_pilot_token: token }, session.access_token);
const insp = await post('/rest/v1/rpc/create_inspection', {
  p_shop: shop, p_vin: 'JTEBU5JR4B5012345', p_year: 2011, p_make: 'Toyota', p_model: '4Runner', p_trim: 'SR5', p_engine: '4.0L V6',
  p_config: VEHICLES[0].config, p_customer_name: 'Dana Smith', p_customer_phone: '', p_customer_email: '', p_ro: '77001', p_odometer: 164210,
  p_concerns: ['Squeak when braking'],
}, session.access_token);
console.log(JSON.stringify({ email, password, shop, inspection: insp }));
