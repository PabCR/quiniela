/* app/(tabs)/_layout.tsx — PLACEHOLDER tab shell.
 *
 * The real tab bar (Matches / Leaderboard / Me) is built by a later agent. This
 * minimal Stack just lets the routing gate navigate into the (tabs) group so the
 * auth flow and typecheck both work end to end. Replace wholesale later.
 */

import { Stack } from 'expo-router';

export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
