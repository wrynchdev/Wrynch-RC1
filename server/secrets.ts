// Encryption for secrets shops give us (their own AI provider keys). AES-256-GCM with a master key that lives only
// in the server environment (SHOP_KEYS_SECRET, 32 random bytes, base64), so a copy of the database alone can't
// reveal any key. Each secret is bound to its shop (additional authenticated data), so a stored value can't be
// moved to another shop. Format: "v1.<iv base64>.<ciphertext+tag base64>".
import { env, HttpError } from './lib';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export const secretsConfigured = () => {
  const s = env('SHOP_KEYS_SECRET');
  try { return !!s && unb64(s).length === 32; } catch { return false; }
};

async function masterKey(): Promise<CryptoKey> {
  if (!secretsConfigured()) throw new HttpError(503, 'Saving AI keys isn’t set up on the server yet (SHOP_KEYS_SECRET is missing or not 32 bytes).');
  return crypto.subtle.importKey('raw', unb64(env('SHOP_KEYS_SECRET')!), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSecret(plain: string, shopId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(shopId) }, await masterKey(), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openSecret(sealed: string, shopId: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new HttpError(500, 'Stored key is in an unknown format');
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(shopId) }, await masterKey(), unb64(ct)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, 'The shop’s AI key couldn’t be unlocked. Re-enter it in Settings.');
  }
}

/** "••••a1B2": all a person ever sees of a saved key. */
export const lastFour = (key: string) => key.trim().slice(-4);
