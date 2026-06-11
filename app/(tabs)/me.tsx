/* app/(tabs)/me.tsx — minimal themed placeholder.
 *
 * A later agent builds the real Me screen (avatar, stat tiles, language toggle,
 * pick history, sign out, admin section). Kept tiny but valid: a ScreenHeader +
 * the signed-in name, token-only.
 */

import { ScrollView, Text, View } from 'react-native';

import { Avatar, ScreenHeader } from '../../components';
import { useSession, useT } from '../../lib/providers';

export default function MeScreen() {
  const t = useT();
  const { profile } = useSession();
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={t('tabMe')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <View className="items-center gap-3 py-8">
          <Avatar name={profile?.name} emoji={profile?.emoji} size="xl" />
          {profile?.name ? (
            <Text className="text-heading text-text">{profile.name}</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
