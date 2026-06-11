/* app/(tabs)/leaderboard.tsx — minimal themed placeholder.
 *
 * A later agent builds the real Leaderboard (rows, top-3, movement, sticky me).
 * Kept tiny but valid: a ScreenHeader + an empty state, token-only.
 */

import { ScrollView, View } from 'react-native';

import { EmptyState, ScreenHeader } from '../../components';
import { useT } from '../../lib/providers';

export default function LeaderboardScreen() {
  const t = useT();
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={t('tabBoard')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <EmptyState emoji="⚽" title={t('boardEmptyTitle')} body={t('boardEmptyBody')} />
      </ScrollView>
    </View>
  );
}
