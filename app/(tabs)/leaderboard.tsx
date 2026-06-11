/* app/(tabs)/leaderboard.tsx — Season leaderboard (README §4, brief §9).
 *
 * Rows from standingsWithMovement — computed on confirmed-final games only.
 * Empty state pre-first-result: ⚽ boardEmptyTitle + boardEmptyBody.
 *
 * Row layout (prototype .lb-row):
 *   rank · avatar + name (+ You chip) · exact-count · movement · points
 *
 * Top-3 emphasis: more padding, 30px filled accent circle rank, 44px avatar.
 * My row pinned: when my row scrolls out of view a floating copy appears above
 * the tab bar (absolute, shadow-float, 2px accent outline). RN has no
 * position:sticky — tracked via FlatList onViewableItemsChanged.
 *
 * Tap any row → /member/[user_id].
 */

import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Chip, EmptyState, ScreenHeader } from '../../components';
import { COLOR_EXACT,
  COLOR_LIVE,
  COLOR_ON_ACCENT,
  COLOR_TEXT_DISABLED,
  TABULAR, COLOR_ACCENT } from '../../components/constants';
import { SHADOW_CARD, SHADOW_FLOAT } from '../../lib/theme';
import { standingsWithMovement, statusOf } from '../../lib/engine';
import { useGames, useMembers, usePool, usePoolData } from '../../lib/data';
import { useSession, useT } from '../../lib/providers';
import { useNow } from '../../lib/now';
import type { StandingRow } from '../../lib/types';
import type { PoolMember } from '../../lib/data';

// Module-level constant — stable reference required by FlatList.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 20 };

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function LeaderboardRow({
  row,
  member,
  isMe,
  isTop,
  onPress,
  t,
}: {
  row: StandingRow;
  member: PoolMember;
  isMe: boolean;
  isTop: boolean;
  onPress: () => void;
  t: ReturnType<typeof useT>;
}) {
  const rankLabel = (row.tied ? 'T-' : '') + row.rank;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={member.name}
      onPress={onPress}
      className="flex-row items-center gap-[10px] rounded-lg bg-surface"
      style={[
        SHADOW_CARD,
        isMe && {
          outlineWidth: 2,
          outlineColor: COLOR_ACCENT,
        } as never,
        {
          paddingHorizontal: isTop ? 14 : 14,
          paddingVertical: isTop ? 14 : 10,
          minHeight: isTop ? undefined : 56,
        },
      ]}
    >
      {/* Rank */}
      {isTop ? (
        <View
          className="h-[30px] w-[30px] items-center justify-center rounded-full bg-accent"
          style={{ minWidth: 30 }}
        >
          <Text
            className="text-on-accent"
            style={[{ fontSize: 14, fontWeight: '650' as never }, TABULAR]}
          >
            {rankLabel}
          </Text>
        </View>
      ) : (
        <Text
          className="text-text-2"
          style={[{ fontSize: 15, fontWeight: '650' as never, minWidth: 34 }, TABULAR]}
        >
          {rankLabel}
        </Text>
      )}

      {/* Avatar */}
      <Avatar
        name={member.name}
        emoji={member.emoji}
        size={isTop ? 'lg' : 'default'}
      />

      {/* Name + You chip */}
      <View className="min-w-0 flex-1 flex-row items-center gap-[7px]">
        <Text
          className="shrink text-body font-semibold text-text"
          numberOfLines={1}
        >
          {member.name}
        </Text>
        {isMe ? (
          <Chip variant="void" label={t('youChip')} style={{ flexShrink: 0 }} />
        ) : null}
      </View>

      {/* Exact count */}
      <Text
        className="text-caption text-text-3"
        style={[{ minWidth: 52, textAlign: 'right' }, TABULAR]}
      >
        {row.exact} {t('exactShort')}
      </Text>

      {/* Movement arrow */}
      <Text
        style={{
          width: 18,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: '650' as never,
          color:
            row.move > 0
              ? COLOR_EXACT   // green ▲
              : row.move < 0
              ? COLOR_LIVE    // red ▼
              : COLOR_TEXT_DISABLED, // gray –
        }}
      >
        {row.move > 0 ? '▲' : row.move < 0 ? '▼' : '–'}
      </Text>

      {/* Total points */}
      <Text
        className="text-text"
        style={[{ fontSize: 22, fontWeight: '700', minWidth: 40, textAlign: 'right' }, TABULAR]}
      >
        {row.pts}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Floating pinned-me row (shown when my real row is off-screen)
// ---------------------------------------------------------------------------

function FloatingMeRow({
  row,
  member,
  t,
  bottomInset,
}: {
  row: StandingRow;
  member: PoolMember;
  t: ReturnType<typeof useT>;
  bottomInset: number;
}) {
  const rankLabel = (row.tied ? 'T-' : '') + row.rank;
  const isTop = row.rank <= 3;

  return (
    <View
      className="absolute left-4 right-4 flex-row items-center gap-[10px] rounded-lg bg-surface"
      style={[
        SHADOW_FLOAT,
        {
          bottom: bottomInset + 8, // 8px gap above tab bar edge
          borderWidth: 2,
          borderColor: COLOR_ACCENT,
          paddingHorizontal: 14,
          paddingVertical: isTop ? 14 : 10,
          minHeight: 56,
        },
      ]}
    >
      {isTop ? (
        <View
          className="h-[30px] w-[30px] items-center justify-center rounded-full bg-accent"
          style={{ minWidth: 30 }}
        >
          <Text
            style={[{ fontSize: 14, fontWeight: '650' as never, color: COLOR_ON_ACCENT }, TABULAR]}
          >
            {rankLabel}
          </Text>
        </View>
      ) : (
        <Text
          className="text-text-2"
          style={[{ fontSize: 15, fontWeight: '650' as never, minWidth: 34 }, TABULAR]}
        >
          {rankLabel}
        </Text>
      )}

      <Avatar name={member.name} emoji={member.emoji} size={isTop ? 'lg' : 'default'} />

      <View className="min-w-0 flex-1 flex-row items-center gap-[7px]">
        <Text className="shrink text-body font-semibold text-text" numberOfLines={1}>
          {member.name}
        </Text>
        <Chip variant="void" label={t('youChip')} style={{ flexShrink: 0 }} />
      </View>

      <Text
        className="text-caption text-text-3"
        style={[{ minWidth: 52, textAlign: 'right' }, TABULAR]}
      >
        {row.exact} {t('exactShort')}
      </Text>

      <Text
        style={{
          width: 18,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: '650' as never,
          color:
            row.move > 0 ? COLOR_EXACT : row.move < 0 ? COLOR_LIVE : COLOR_TEXT_DISABLED,
        }}
      >
        {row.move > 0 ? '▲' : row.move < 0 ? '▼' : '–'}
      </Text>

      <Text
        className="text-text"
        style={[{ fontSize: 22, fontWeight: '700', minWidth: 40, textAlign: 'right' }, TABULAR]}
      >
        {row.pts}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function LeaderboardScreen() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const myId = session?.user.id ?? null;

  const games = useGames();
  const members = useMembers();
  const pool = usePool();
  const { guessesByGame } = usePoolData();
  const now = useNow();

  // Visibility tracking for the sticky-me row
  const [myRowVisible, setMyRowVisible] = useState(true);
  const myRowKey = myId ?? '';

  // Build AllPicks map from guessesByGame
  const allPicks = useMemo(() => {
    const picks: Record<number, Record<string, { home: number; away: number; advancer: string | null }>> = {};
    for (const [gameId, byUser] of Object.entries(guessesByGame)) {
      picks[Number(gameId)] = {};
      for (const [userId, g] of Object.entries(byUser)) {
        picks[Number(gameId)][userId] = { home: g.home, away: g.away, advancer: g.advancer };
      }
    }
    return picks;
  }, [guessesByGame]);

  // Compute standings with movement
  const rows = useMemo(() => {
    if (!members.length) return [];
    return standingsWithMovement(
      members.map((m) => ({ id: m.user_id })),
      games,
      allPicks,
      now,
      pool?.pts_full ?? 3,
      pool?.pts_partial ?? 1,
    );
  }, [members, games, allPicks, now, pool]);

  // Has any confirmed result yet?
  const anyFinal = useMemo(
    () => games.some((g) => statusOf(g, now) === 'final'),
    [games, now],
  );

  const memberMap = useMemo(() => {
    const m: Record<string, PoolMember> = {};
    for (const mb of members) m[mb.user_id] = mb;
    return m;
  }, [members]);

  const myRow = rows.find((r) => r.id === myId);

  // Track visibility of my row in the FlatList
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const visible = viewableItems.some((v) => v.key === myRowKey);
      setMyRowVisible(visible);
    },
    [myRowKey],
  );
  // Tab bar height (approximate — safe area bottom + 48px bar)
  const tabBarHeight = insets.bottom + 48;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={t('tabBoard')} />

      {!anyFinal ? (
        <EmptyState emoji="⚽" title={t('boardEmptyTitle')} body={t('boardEmptyBody')} />
      ) : (
        <>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY_CONFIG}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 6,
              paddingBottom: 24 + tabBarHeight,
              gap: 8,
            }}
            renderItem={({ item: row }) => {
              const member = memberMap[row.id];
              if (!member) return null;
              const isMe = row.id === myId;
              const isTop = row.rank <= 3;
              return (
                <LeaderboardRow
                  row={row}
                  member={member}
                  isMe={isMe}
                  isTop={isTop}
                  onPress={() => router.push(`/member/${row.id}` as never)}
                  t={t}
                />
              );
            }}
          />

          {/* Floating pinned row — shown when my row scrolls off screen */}
          {myRow && !myRowVisible && myId && memberMap[myId] ? (
            <FloatingMeRow
              row={myRow}
              member={memberMap[myId]}
              t={t}
              bottomInset={tabBarHeight}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
