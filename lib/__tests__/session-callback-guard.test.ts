/* Regression guard for the supabase-js onAuthStateChange deadlock.
 *
 * The auth callback in SessionProvider MUST stay synchronous and contain zero
 * supabase.* calls — any supabase call inside it re-acquires the held GoTrue lock
 * and hangs the app on cold launch (spinner forever). See the spec, §2.
 *
 * Operates on raw source TEXT (not an AST): keep the callback INLINE inside the
 * onAuthStateChange( ... ) call or the extractor below grabs the wrong body.
 *
 * MUST be committed together with the fixed providers.tsx (spec §8.2) — it fails
 * against the pre-fix file. It catches an `async`/`await` callback; a supabase
 * call hidden behind an indirection (e.g. loadFor) is NOT textually visible here,
 * so keep the actual fetching out of the callback regardless.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  fileURLToPath(new URL('../providers.tsx', import.meta.url)),
  'utf8',
);

/** Extract the full onAuthStateChange( ... ) call via a balanced-paren scan. */
function authCallbackSource(src: string): string {
  const marker = 'onAuthStateChange(';
  const start = src.indexOf(marker);
  expect(start, 'onAuthStateChange( not found in providers.tsx').toBeGreaterThan(
    -1,
  );
  let depth = 0;
  let i = start + marker.length - 1; // sits on the opening '('
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

describe('onAuthStateChange callback is deadlock-safe', () => {
  const body = authCallbackSource(SRC);

  it('is not declared async', () => {
    expect(/onAuthStateChange\(\s*async/.test(SRC)).toBe(false);
  });

  it('contains no await', () => {
    expect(/\bawait\b/.test(body)).toBe(false);
  });

  it('makes no supabase.* calls', () => {
    expect(/\bsupabase\s*\./.test(body)).toBe(false);
  });
});
