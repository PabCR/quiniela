/* components/Avatar.tsx — emoji avatar with initials-in-circle fallback.
 *
 * Mirrors prototype .av / .av--lg / .av--xl:
 *   default 32px  / emoji 17px / initials 13px-650
 *   lg      44px  / emoji 24px
 *   xl      72px  / emoji 40px
 * Background = surface-3 token; initials use text-2. No hardcoded colors.
 */

import { Text, View, type ViewStyle } from 'react-native';

export type AvatarSize = 'default' | 'lg' | 'xl';

const DIMS: Record<AvatarSize, { box: number; emoji: number; initials: number }> = {
  default: { box: 32, emoji: 17, initials: 13 },
  lg: { box: 44, emoji: 24, initials: 16 },
  xl: { box: 72, emoji: 40, initials: 24 },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  emoji,
  size = 'default',
  style,
}: {
  name?: string;
  emoji?: string | null;
  size?: AvatarSize;
  style?: ViewStyle;
}) {
  const d = DIMS[size];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name}
      className="items-center justify-center rounded-full bg-surface-3"
      style={[{ width: d.box, height: d.box }, style]}
    >
      {emoji ? (
        <Text style={{ fontSize: d.emoji, lineHeight: d.emoji * 1.15 }}>{emoji}</Text>
      ) : (
        <Text
          className="font-semibold text-text-2"
          style={{ fontSize: d.initials }}
        >
          {initialsOf(name ?? '')}
        </Text>
      )}
    </View>
  );
}
