/* app/_layout.tsx — root layout.
 *
 * Wraps the app in the gesture-handler root, safe-area provider, and the
 * Session/Lang providers, then renders the Expo Router Stack. The actual
 * authentication gating lives in app/index.tsx (the gate route) and the per-step
 * auth screens — this layout just makes the providers available app-wide and
 * keeps headers hidden (every screen draws its own chrome).
 */

import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { COLOR_BG } from '../components/constants';
import { PoolDataProvider } from '../lib/data';
import { AppProviders } from '../lib/providers';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProviders>
          {/* PoolDataProvider is mounted at the root, AFTER the auth providers
              (AppProviders → Session/Lang), so BOTH the (tabs) group and the
              app/match/[id] detail route — which lives OUTSIDE (tabs) — share a
              single data context + one realtime channel. It no-ops (loading
              resolves immediately) until the session resolves a membership, so
              it is harmless on the pre-auth/auth screens. Documented choice per
              brief §D: "root layout AFTER auth gate is acceptable." */}
          <PoolDataProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: COLOR_BG },
              }}
            />
          </PoolDataProvider>
          <StatusBar style="dark" />
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
