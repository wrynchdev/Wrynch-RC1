// Entry for the iOS rules bundle. Swift calls WrynchCall(name, argsJson) and gets {"ok": result} or {"error": message}.
import * as W from './bridge';

const fns = W as unknown as Record<string, (...args: unknown[]) => unknown>;
const g = globalThis as unknown as Record<string, unknown>;
g.WrynchCall = (name: string, argsJson: string): string => {
  try {
    const fn = fns[name];
    if (typeof fn !== 'function') throw new Error(`Unknown function ${name}`);
    return JSON.stringify({ ok: fn(...(JSON.parse(argsJson) as unknown[])) ?? null });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
};
