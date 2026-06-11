/* app/index.tsx — the routing gate (brief §7).
 *
 * The app's entry route. It owns no UI of its own beyond a brief loading state;
 * it reads the session/membership from the provider and redirects:
 *
 *   loading                       → spinner (session + profile still resolving)
 *   no session                    → /auth/invite     (first-run invite gate)
 *   session + membership          → /(tabs)          (returning user, straight in)
 *   session + NO membership       → /auth/profile    (authed but never joined;
 *                                                      profile re-checks the
 *                                                      stored invite code or
 *                                                      bounces to invite)
 *
 * Using <Redirect> (declarative) so the gate re-evaluates whenever the provider
 * state changes — e.g. after join_pool refreshes membership, this flips from
 * /auth/profile to /(tabs) on its own.
 */

import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '../lib/providers';

export default function Index() {
  const { session, membership, loading } = useSession();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#12181f" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/auth/invite" />;
  }

  if (membership) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth/profile" />;
}
