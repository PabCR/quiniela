/* app/admin/_layout.tsx — guard + Stack shell for the admin area.
 *
 * Non-admin → Redirect to /(tabs) (prevents a non-admin from navigating
 * here via deep link). Loading state renders nothing (avoids flash). A
 * membership with role 'admin' passes through.
 *
 * A simple headerless Stack; each screen draws its own back-button header
 * using the circular-button idiom from app/match/[id].tsx.
 */

import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '../../lib/providers';
import { COLOR_TEXT } from '../../components/constants';

export default function AdminLayout() {
  const { membership, loading } = useSession();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLOR_TEXT} />
      </View>
    );
  }

  if (!membership || membership.role !== 'admin') {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
