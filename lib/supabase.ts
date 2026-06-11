/* lib/supabase.ts — Supabase client for React Native / Expo.
 *
 * Session persistence:
 *   Expo SecureStore caps a single value at ~2048 bytes. A Supabase session
 *   (access + refresh token + user) can exceed that, so we use the documented
 *   LargeSecureStore pattern: an AES-256 key lives in SecureStore (the secure
 *   keystore / keychain), and it encrypts the session blob which is stored in
 *   AsyncStorage. This keeps the secret in hardware-backed storage while
 *   sidestepping the size limit.
 *   (Source: Supabase "with Expo React Native" guide, via Context7.)
 *
 * Token refresh:
 *   autoRefreshToken is on, but supabase-js can only run its background timer
 *   while the JS engine is awake. We wire AppState so refresh starts when the
 *   app is foregrounded and stops when backgrounded — the documented RN setup.
 *
 * detectSessionInUrl is false: there is no browser URL to parse on native; OTP
 * verification is handled explicitly via verifyOtp in the auth screens.
 */

import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in the local-stack values.',
  );
}

/**
 * Encrypts values with a per-key AES-256 secret held in SecureStore, and keeps
 * the ciphertext in AsyncStorage. Implements the supabase-js storage interface.
 */
class LargeSecureStore {
  private async _encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));

    const cipher = new aesjs.ModeOfOperation.ctr(
      encryptionKey,
      new aesjs.Counter(1),
    );
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return null;
    }
    return this._decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Wire token auto-refresh to the JS engine's wake state. supabase-js can only
 * refresh while the runtime is awake, so start the timer on foreground and stop
 * it on background. Call once from the root provider; returns an unsubscribe.
 */
export function registerAppStateAutoRefresh(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
  // Kick off immediately for the initial (active) state.
  supabase.auth.startAutoRefresh();
  return () => subscription.remove();
}
