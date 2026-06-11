/* lib/onboarding.ts — pending invite-code handoff across the auth flow.
 *
 * The invite code is collected on the first screen (invite.tsx) and consumed
 * several screens later by join_pool on the profile screen. The OTP round-trip
 * can drop in-memory React state (process can be backgrounded on native), so we
 * persist the validated code to AsyncStorage and also keep a synchronous memory
 * copy for instant reads. Cleared once join_pool succeeds.
 *
 * Codes are normalised to the server's canonical form (upper + trim) so the
 * value stored here matches what check_invite_code / join_pool expect.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_INVITE_KEY = 'quiniela.pendingInviteCode';

let memoryCode: string | null = null;

/** Canonicalise to the server's form (upper-case, trimmed). */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function setPendingInviteCode(code: string): Promise<void> {
  const normalized = normalizeInviteCode(code);
  memoryCode = normalized;
  await AsyncStorage.setItem(PENDING_INVITE_KEY, normalized);
}

export async function getPendingInviteCode(): Promise<string | null> {
  if (memoryCode) return memoryCode;
  const v = await AsyncStorage.getItem(PENDING_INVITE_KEY);
  memoryCode = v;
  return v;
}

export async function clearPendingInviteCode(): Promise<void> {
  memoryCode = null;
  await AsyncStorage.removeItem(PENDING_INVITE_KEY);
}
