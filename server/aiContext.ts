// Which AI account a request uses: the shop's own key when the owner saved one in Settings, otherwise Wrynch's
// (OPENAI_API_KEY or ANTHROPIC_API_KEY; AI_PROVIDER picks one when both are set). Kept per request so concurrent
// requests from different shops never mix keys.
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from './lib';

export type AiProvider = 'anthropic' | 'openai';
export interface AiAccount { provider: AiProvider; key: string; model: string; source: 'shop' | 'platform' }
export interface ShopAi { provider: AiProvider; key: string; model: string | null }

const store = new AsyncLocalStorage<ShopAi | null>();
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-5';

/** Wrynch's own AI account from the server settings, or null when none is set. */
export function platformAi(): AiAccount | null {
  const anthropic = env('ANTHROPIC_API_KEY'), openai = env('OPENAI_API_KEY');
  const want = env('AI_PROVIDER')?.trim().toLowerCase();
  const provider: AiProvider | null = want === 'openai' && openai ? 'openai' : want === 'anthropic' && anthropic ? 'anthropic'
    : anthropic && !openai ? 'anthropic' : openai && !anthropic ? 'openai' : anthropic ? 'anthropic' : null;
  if (provider === 'openai') return { provider, key: openai!, model: env('OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL, source: 'platform' };
  if (provider === 'anthropic') return { provider, key: anthropic!, model: env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL, source: 'platform' };
  return null;
}

export function withShopAi<T>(shop: ShopAi | null, fn: () => Promise<T>): Promise<T> { return store.run(shop, fn); }

/** The account to use right now, or null when there's no AI at all. */
export function currentAi(): AiAccount | null {
  const shop = store.getStore();
  if (shop?.key) return { provider: shop.provider, key: shop.key, model: shop.model || (shop.provider === 'anthropic' ? env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL : ''), source: 'shop' };
  return platformAi();
}
