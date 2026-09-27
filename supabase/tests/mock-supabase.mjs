// A tiny local stand-in for Supabase's HTTP API, backed by a real PostgreSQL loaded with our migrations.
// For end-to-end tests only: it trusts any token it issued and does not verify signatures.
//
//   PGURL=postgresql://postgres@/postgres?host=/tmp/x&port=5498 node supabase/tests/mock-supabase.mjs
//   -> http://localhost:54321  (anon key "anon", service key "service")
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PGURL = process.env.PGURL;
const PORT = Number(process.env.MOCK_PORT ?? 54321);
if (!PGURL) { console.error('Set PGURL'); process.exit(1); }

function psql(sql, vars = {}) {
  const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', PGURL];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync('psql', args, { input: sql, encoding: 'utf8' });
  if (r.status !== 0) {
    const m = /ERROR:\s+(.*)/.exec(r.stderr);
    const err = new Error(m ? m[1].trim() : r.stderr.trim());
    err.pg = true;
    throw err;
  }
  return r.stdout.trim();
}

// Function signatures, for turning JSON arguments into typed SQL arguments.
const sigs = {};
for (const line of psql(`select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '') || '|' ||
    coalesce((select string_agg(format_type(t, null), ',' order by o) from unnest(p.proargtypes) with ordinality u(t, o)), '') || '|' || format_type(p.prorettype, null)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`).split('\n')) {
  const [name, names, types, ret] = line.split('|');
  sigs[name] = { names: names ? names.split(',') : [], types: types ? types.split(',') : [], ret };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (user) => `${b64({ alg: 'none' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const claimsOf = (auth) => {
  const t = (auth ?? '').replace(/^Bearer\s+/i, '');
  if (t === 'service') return { role: 'service_role' };
  if (t === 'anon' || !t) return { role: 'anon' };
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return { role: 'anon' }; }
};
const sessionFor = (user) => ({ access_token: token(user), refresh_token: `r-${user.id}`, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email } });

const users = new Map(); // email -> {id, email, password}
const files = new Map(); // path -> {bytes, type}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function castArg(name, type) {
  const v = `(:'args'::jsonb)`;
  if (type === 'jsonb') return `${name} => nullif(${v}->'${name}', 'null'::jsonb)`;
  if (type === 'text[]') return `${name} => case when jsonb_typeof(${v}->'${name}') = 'array' then array(select jsonb_array_elements_text(${v}->'${name}')) end`;
  return `${name} => (${v}->>'${name}')::${type}`;
}

function rpc(fn, args, claims) {
  const s = sigs[fn];
  if (!s) throw Object.assign(new Error(`Could not find the function public.${fn}`), { status: 404 });
  const call = `public.${fn}(${s.names.filter((n) => n in args).map((n) => castArg(n, s.types[s.names.indexOf(n)])).join(', ')})`;
  const role = claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon';
  const sel = s.ret === 'void' ? `select ${call};` : `select to_jsonb(${call});`;
  const out = psql(`begin; select set_config('request.jwt.claims', :'claims', true) \\g /dev/null
set local role ${role};
${sel}
commit;`, { args: JSON.stringify(args), claims: JSON.stringify(claims) });
  return s.ret === 'void' ? null : JSON.parse(out || 'null');
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const json = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
  const claims = claimsOf(req.headers.authorization);
  try {
    // ---- auth
    if (url.pathname === '/auth/v1/signup') {
      const { email, password } = json();
      if (users.has(email)) return send(res, 422, { msg: 'User already registered' });
      const u = { id: randomUUID(), email, password };
      users.set(email, u);
      psql(`insert into auth.users values (:'id', :'email');`, { id: u.id, email });
      return send(res, 200, sessionFor(u));
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const id = json().refresh_token?.slice(2);
        const u = [...users.values()].find((x) => x.id === id);
        return u ? send(res, 200, sessionFor(u)) : send(res, 400, { error_description: 'Invalid Refresh Token' });
      }
      const { email, password } = json();
      const u = users.get(email);
      if (!u || u.password !== password) return send(res, 400, { error_description: 'Invalid login credentials' });
      return send(res, 200, sessionFor(u));
    }
    if (url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/recover') return send(res, 204, '');

    // ---- database functions
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (m && req.method === 'POST') return send(res, 200, rpc(m[1], json(), claims));

    // ---- storage (runs the real storage.objects policy for uploads)
    const up = /^\/storage\/v1\/object\/inspection-media\/(.+)$/.exec(url.pathname);
    if (up && req.method === 'POST') {
      const path = decodeURIComponent(up[1]);
      psql(`begin; select set_config('request.jwt.claims', :'claims', true) \\g /dev/null
set local role authenticated;
insert into storage.objects (bucket_id, name) values ('inspection-media', :'path');
commit;`, { claims: JSON.stringify(claims), path });
      files.set(path, { bytes: raw, type: req.headers['content-type'] ?? 'image/jpeg' });
      return send(res, 200, { Key: `inspection-media/${path}` });
    }
    if (up && req.method === 'GET') {
      if (claims.role !== 'service_role') return send(res, 403, { message: 'service only in mock' });
      const f = files.get(decodeURIComponent(up[1]));
      return f ? send(res, 200, f.bytes, f.type) : send(res, 404, { message: 'Object not found' });
    }
    if (url.pathname === '/storage/v1/object/sign/inspection-media' && req.method === 'POST') {
      const { paths } = json();
      return send(res, 200, paths.map((p) => ({ path: p, signedURL: files.has(p) ? `/object/mock-signed/${p}` : null })));
    }
    const signed = /^\/storage\/v1\/object\/mock-signed\/(.+)$/.exec(url.pathname);
    if (signed) { const f = files.get(decodeURIComponent(signed[1])); return f ? send(res, 200, f.bytes, f.type) : send(res, 404, 'missing', 'text/plain'); }

    return send(res, 404, { message: 'Not found in mock' });
  } catch (e) {
    return send(res, e.status ?? 400, { message: e.message });
  }
}).listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT}`));
