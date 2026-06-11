/* components/ScreenHeader.tsx — the .hd header pattern.
 *
 * Title (22/700) on the left, an optional right slot (the pending pill, a lang
 * toggle, etc.). Top padding clears the status bar via the safe-area inset plus
 * the prototype's 66px breathing room (scaled with the inset like the auth
 * scaffold). An optional `below` slot renders under the title row (filter chips).
 */

import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ScreenHeader({
  title,
  right,
  below,
}: {
  title: string;
  right?: React.ReactNode;
  below?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Prototype .hd uses 66px top padding; on hardware add a share of the inset.
  const topPad = 18 + insets.top;

  return (
    <View className="gap-[10px] px-4 pb-1" style={{ paddingTop: topPad }}>
      <View className="flex-row items-center justify-between gap-[10px]">
        <Text className="text-title text-text" accessibilityRole="header">
          {title}
        </Text>
        {right ? <View>{right}</View> : null}
      </View>
      {below ? <View>{below}</View> : null}
    </View>
  );
}
