/* app/(tabs)/index.tsx — PLACEHOLDER "Matches coming" screen.
 *
 * Minimal themed screen so the authed destination renders. A later agent
 * replaces this with the real Matches list. Kept token-only (no hardcoded
 * colors) so it already matches the design system.
 */

import { Text, View } from 'react-native';

import { useT } from '../../lib/providers';

export default function MatchesPlaceholder() {
  const t = useT();
  return (
    <View className="flex-1 items-center justify-center bg-bg px-6">
      <Text className="mb-2 text-title text-text">{t('tabMatches')}</Text>
      <Text className="text-body text-text-2">⚽</Text>
    </View>
  );
}
