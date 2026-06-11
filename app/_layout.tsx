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

import { AppProviders } from '../lib/providers';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProviders>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#f5f7f9' },
            }}
          />
          <StatusBar style="dark" />
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
