// Shared server helpers: environment, HTTP responses, and Supabase REST calls (no SDK needed).
import type { IncomingMessage, ServerResponse } from 'node:http';

export const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};
export function need(k: string): string {
  const v = env(k);
  if (!v) throw new HttpError(500, `Server is missing the ${k} setting`);
  // Accept the Supabase address with or without a pasted API path (e.g. "…supabase.co/rest/v1/").
  return k === 'SUPABASE_URL' ? v.replace(/\/+(rest|auth|storage)\/v1\/?$/, '').replace(/\/+$/, '') : v;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export type Handler = (req: Request) => Promise<Response>;

/** Wrap a Web-style handler: turns thrown HttpErrors into JSON errors and hides other errors. */
export function route(methods: Record<string, Handler>): Handler {
  return async (req) => {
    const h = methods[req.method];
    if (!h) return json({ error: 'Method not allowed' }, 405);
    try {
      return await h(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  };
}

/** Adapter for Vercel's Node runtime (and the local dev server): Node req/res -> Web Request/Response. */
export function toNode(handler: Handler) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const host = req.headers.host ?? 'localhost';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(`https://${host}${req.url}`, {
      method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const out = await handler(request);
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await out.arrayBuffer()));
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Request body must be JSON'); }
}

export function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new HttpError(401, 'Sign in first');
  return m[1];
}

// ------------------------------------------------------------------ Supabase REST

/**
 * Headers for the server key. Supabase's newer secret keys (sb_secret_…) go only in the apikey header;
 * the older service_role key is a JWT and also goes in Authorization. Both work.
 */
export function serviceHeaders(): Record<string, string> {
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
}

/** Call a database function. `as` is the user's access token, or 'service' for the server key. */
export async function rpc<T>(name: string, args: Record<string, unknown>, as: string | 'service'): Promise<T> {
  const url = need('SUPABASE_URL');
  const auth = as === 'service' ? serviceHeaders() : { apikey: need('SUPABASE_ANON_KEY'), authorization: `Bearer ${as}` };
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message ?? text; } catch { /* keep text */ }
    const status = r.status === 401 ? 401 : r.status === 403 ? 403 : r.status === 404 ? 404 : 400;
    throw new HttpError(status, msg);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function downloadObject(path: string): Promise<{ bytes: Uint8Array; type: string }> {
  const url = need('SUPABASE_URL');
  const r = await fetch(`${url}/storage/v1/object/inspection-media/${path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: serviceHeaders(),
  });
  if (!r.ok) throw new HttpError(502, `Couldn't read photo ${path}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') ?? 'image/jpeg' };
}

/** Signed, time-limited photo URLs (service key; only used for content already filtered for the viewer). */
export async function signUrls(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const url = need('SUPABASE_URL');
  const r = await fetch(`${url}/storage/v1/object/sign/inspection-media`, {
    method: 'POST',
    headers: { ...serviceHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds, paths }),
  });
  if (!r.ok) throw new HttpError(502, "Couldn't prepare photo links");
  const list = (await r.json()) as { path: string; signedURL: string | null }[];
  const out: Record<string, string> = {};
  for (const x of list) if (x.signedURL) out[x.path] = `${url}/storage/v1${x.signedURL}`;
  return out;
}
