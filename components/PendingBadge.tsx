/* components/PendingBadge.tsx — the picks-pending header pill (prototype .hd-badge).
 *
 * Two states:
 *   pending > 0  accent fill / on-accent text, a small dot, "N picks pending"
 *                (singular form at 1). Tapping filters the list to pending.
 *   pending = 0  green-soft fill / exact text, "All picked ✓".
 *
 * The MVP reminder mechanism (no push). Never color-alone: the count text + dot
 * carry the meaning alongside the accent fill.
 */

import { Pressable, Text, View } from 'react-native';

import type { Translate } from '../lib/i18n';

export function PendingBadge({
  count,
  onPress,
  t,
}: {
  count: number;
  onPress: () => void;
  t: Translate;
}) {
  const done = count === 0;
  const label = done
    ? t('pendingNone')
    : count === 1
      ? t('pending_one')
      : t('pending_other', { n: count });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      className={
        'min-h-[38px] flex-row items-center gap-[7px] rounded-pill px-[14px] py-[9px] ' +
        (done ? 'bg-exact-soft' : 'bg-accent')
      }
    >
      {!done ? <View className="h-[7px] w-[7px] rounded-full bg-on-accent" /> : null}
      <Text className={'text-label font-semibold ' + (done ? 'text-exact' : 'text-on-accent')}>
        {label}
      </Text>
    </Pressable>
  );
}
