/* components/EmptyState.tsx — centered emoji + heading + body (prototype .lb-empty).
 *
 * Big emoji (44px), a heading, an optional body capped at a readable width.
 * Used by the filtered-matches "all picked 🎉" state and the leaderboard
 * pre-first-result state. Token-only colors.
 */

import { Text, View } from 'react-native';

export function EmptyState({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body?: string;
}) {
  return (
    <View className="items-center gap-2 px-6 py-10">
      <Text style={{ fontSize: 44, lineHeight: 50 }}>{emoji}</Text>
      <Text className="text-center text-heading text-text">{title}</Text>
      {body ? (
        <Text className="max-w-[270px] text-center text-body text-text-2">{body}</Text>
      ) : null}
    </View>
  );
}
