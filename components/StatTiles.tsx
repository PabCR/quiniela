/* components/StatTiles.tsx — 3-tile stat grid (prototype .statgrid / .stat).
 *
 * Renders the 3 key stats for a member: Points / Exact scores / Position.
 * Values use 26px/700 tabular numerals (prototype .stat .v font: 700 26px).
 * Captions are text-caption in text-text-3 (prototype .stat .l).
 *
 * The `rank` tile renders the T-prefix when tied ("T-2" or "T-3").
 * Values render "—" (em-dash) until there is a real value (zero is legit).
 */

import { Text, View } from 'react-native';
import { TABULAR } from './constants';
import { SHADOW_CARD } from '../lib/theme';

interface Tile {
  value: string;
  label: string;
}

export function StatTiles({ tiles }: { tiles: [Tile, Tile, Tile] }) {
  return (
    <View className="mb-[14px] flex-row gap-[10px]">
      {tiles.map(({ value, label }) => (
        <View
          key={label}
          className="flex-1 items-center rounded-lg bg-surface py-[14px]"
          style={SHADOW_CARD}
        >
          <Text
            className="text-text"
            style={[{ fontSize: 26, fontWeight: '700', lineHeight: 30 }, TABULAR]}
          >
            {value}
          </Text>
          <Text className="mt-[2px] text-center text-caption text-text-3">{label}</Text>
        </View>
      ))}
    </View>
  );
}
