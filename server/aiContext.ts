// Which AI account a request uses: the shop's own key when the owner saved one in Settings, otherwise Wrynch's
// (ANTHROPIC_API_KEY). Kept per request so concurrent requests from different shops never mix keys.
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from './lib';

export type AiProvider = 'anthropic' | 'openai';
export interface AiAccount { provider: AiProvider; key: string; model: string; source: 'shop' | 'platform' }
export interface ShopAi { provider: AiProvider; key: string; model: string | null }

const store = new AsyncLocalStorage<ShopAi | null>();
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';

export function withShopAi<T>(shop: ShopAi | null, fn: () => Promise<T>): Promise<T> { return store.run(shop, fn); }

/** The account to use right now, or null when there's no AI at all. */
export function currentAi(): AiAccount | null {
  const shop = store.getStore();
  if (shop?.key) return { provider: shop.provider, key: shop.key, model: shop.model || (shop.provider === 'anthropic' ? env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL : ''), source: 'shop' };
  const k = env('ANTHROPIC_API_KEY');
  return k ? { provider: 'anthropic', key: k, model: env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL, source: 'platform' } : null;
}
