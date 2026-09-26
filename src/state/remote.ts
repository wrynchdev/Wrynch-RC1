// Talks to Supabase (auth, database functions, photo storage) and the app's /api functions over plain fetch.
declare const __WRYNCH_CONFIG__: { supabaseUrl: string; supabaseAnonKey: string };

const CFG = typeof __WRYNCH_CONFIG__ !== 'undefined' ? __WRYNCH_CONFIG__ : { supabaseUrl: '', supabaseAnonKey: '' };
export const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const URL_ = CFG.supabaseUrl.replace(/\/$/, '');
const KEY = CFG.supabaseAnonKey;

export interface Session { accessToken: string; refreshToken: string; expiresAt: number; userId: string; email: string }
const SESSION_KEY = 'wrynch-session';

let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { session = null; }
const onChange = new Set<(s: Session | null) => void>();
export const getSession = () => session;
export function onSession(fn: (s: Session | null) => void) { onChange.add(fn); return () => onChange.delete(fn); }
function setSession(s: Session | null) {
  session = s;
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  onChange.forEach((f) => f(s));
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function parse(r: Response): Promise<unknown> {
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const b = body as Record<string, string> | null;
    const msg = (b && (b.message || b.error_description || b.msg || b.error)) || `Request failed (${r.status})`;
    throw new ApiError(r.status, friendly(String(msg)));
  }
  return body;
}

function friendly(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match an account.';
  if (/Email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you.';
  if (/User already registered/i.test(msg)) return 'An account with that email already exists. Sign in instead.';
  if (/JWT expired/i.test(msg)) return 'Your session expired. Sign in again.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Can’t reach the server. Check your connection and try again.';
  return msg;
}

function toSession(b: Record<string, unknown>): Session {
  const user = b.user as { id: string; email: string };
  return {
    accessToken: b.access_token as string, refreshToken: b.refresh_token as string,
    expiresAt: Date.now() + (Number(b.expires_in) || 3600) * 1000, userId: user.id, email: user.email,
  };
}

async function authPost(path: string, body: unknown, token?: string) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return parse(r) as Promise<Record<string, unknown>>;
}

let refreshing: Promise<void> | null = null;
async function fresh(): Promise<string> {
  if (!session) throw new ApiError(401, 'Sign in first');
  if (session.expiresAt - Date.now() < 60_000) {
    refreshing ??= authPost('token?grant_type=refresh_token', { refresh_token: session.refreshToken })
      .then((b) => setSession(toSession(b)))
      .catch(() => { setSession(null); throw new ApiError(401, 'Your session expired. Sign in again.'); })
      .finally(() => { refreshing = null; });
    await refreshing;
  }
  return session!.accessToken;
}

export const auth = {
  async signIn(email: string, password: string) { setSession(toSession(await authPost('token?grant_type=password', { email, password }))); },
  /** Returns true when signed in immediately, false when the project requires email confirmation. */
  async signUp(email: string, password: string, name: string): Promise<boolean> {
    const b = await authPost('signup', { email, password, data: { name } });
    if (b.access_token) { setSession(toSession(b)); return true; }
    return false;
  },
  async resetPassword(email: string) { await authPost('recover', { email }); },
  async setPassword(password: string) {
    const token = await fresh();
    const r = await fetch(`${URL_}/auth/v1/user`, { method: 'PUT', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    await parse(r);
  },
  async signOut() {
    const t = session?.accessToken;
    setSession(null);
    if (t) await fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${t}` } }).catch(() => undefined);
  },
  /** Email links (confirm, reset password) land with tokens in the URL hash. Returns the link type if handled. */
  consumeLinkTokens(): string | null {
    const h = window.location.hash;
    if (!h.includes('access_token=')) return null;
    const p = new URLSearchParams(h.replace(/^#\/?/, ''));
    const accessToken = p.get('access_token');
    if (!accessToken) return null;
    let claims: { sub?: string; email?: string } = {};
    try { claims = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* ignore */ }
    setSession({ accessToken, refreshToken: p.get('refresh_token') ?? '', expiresAt: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000,
      userId: claims.sub ?? '', email: claims.email ?? '' });
    const type = p.get('type') ?? 'signup';
    history.replaceState(null, '', window.location.pathname + (type === 'recovery' ? '#/account/password' : '#/'));
    return type;
  },
};

/** Call a database function as the signed-in user. */
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = await fresh();
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  if (r.status === 401) setSession(null);
  return parse(r) as Promise<T>;
}

/** Call one of this app's /api functions. */
export async function fn<T = unknown>(name: string, body?: unknown, method = 'POST', auth = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${await fresh()}`;
  const r = await fetch(`/api/${name}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return parse(r) as Promise<T>;
}

export async function upload(path: string, blob: Blob) {
  const token = await fresh();
  const r = await fetch(`${URL_}/storage/v1/object/inspection-media/${path}`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': blob.type || 'image/jpeg', 'x-upsert': 'false' }, body: blob,
  });
  await parse(r);
}

export async function signPhotos(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const token = await fresh();
  const r = await fetch(`${URL_}/storage/v1/object/sign/inspection-media`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600, paths }),
  });
  const list = (await parse(r)) as { path: string; signedURL: string | null }[];
  const out: Record<string, string> = {};
  for (const x of list) if (x.signedURL) out[x.path] = `${URL_}/storage/v1${x.signedURL}`;
  return out;
}

/** Shrink a camera photo before upload: long side 1600 px, JPEG. Saves data and keeps AI calls fast. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}
