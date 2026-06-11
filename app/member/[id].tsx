/* app/member/[id].tsx — Member profile screen (README §4, brief §9).
 *
 * Back-button header matching app/match/[id].tsx idiom (IcBack + centered title).
 * Content:
 *   - xl Avatar + name (centered)
 *   - StatTiles: Points / Exact scores / Position (T- prefix when tied)
 *   - HistoryList for this member (t('profileHistory'))
 *
 * Data: reads the member's guesses from guessesByGame (RLS-gated post-kickoff).
 * Standings are computed the same way as the leaderboard (standingsWithMovement).
 */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { Avatar, IcBack } from '../../components';
import { HistoryList } from '../../components/HistoryList';
import { StatTiles } from '../../components/StatTiles';
import { COLOR_TEXT } from '../../components/constants';
import { SHADOW_CARD } from '../../lib/theme';
import { standingsWithMovement } from '../../lib/engine';
import { useGames, useMembers, usePool, usePoolData } from '../../lib/data';
import { useT } from '../../lib/providers';
import { useNow } from '../../lib/now';

export default function MemberProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const t = useT();
  const now = useNow();

  const { id: memberId } = useLocalSearchParams<{ id: string }>();

  const games = useGames();
  const members = useMembers();
  const pool = usePool();
  const { guessesByGame, teams } = usePoolData();

  const member = useMemo(
    () => members.find((m) => m.user_id === memberId),
    [members, memberId],
  );

  // Build AllPicks map
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

  // Standings row for this member
  const standingRow = useMemo(() => {
    if (!members.length) return null;
    const rows = standingsWithMovement(
      members.map((m) => ({ id: m.user_id })),
      games,
      allPicks,
      now,
      pool?.pts_full ?? 3,
      pool?.pts_partial ?? 1,
    );
    return rows.find((r) => r.id === memberId) ?? null;
  }, [members, games, allPicks, now, pool, memberId]);

  // Member's guesses (keyed by game id)
  const memberGuesses = useMemo(() => {
    const out: Record<number, import('../../lib/types').Guess | undefined> = {};
    for (const [gameId, byUser] of Object.entries(guessesByGame)) {
      if (memberId && byUser[memberId]) {
        out[Number(gameId)] = byUser[memberId];
      }
    }
    return out;
  }, [guessesByGame, memberId]);

  if (!member) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLOR_TEXT} />
      </View>
    );
  }

  const pts = standingRow?.pts ?? 0;
  const exact = standingRow?.exact ?? 0;
  const rankLabel = standingRow
    ? (standingRow.tied ? 'T-' : '') + standingRow.rank
    : '—';

  const tiles: [
    { value: string; label: string },
    { value: string; label: string },
    { value: string; label: string },
  ] = [
    { value: String(pts), label: t('statPoints') },
    { value: String(exact), label: t('statExact') },
    { value: rankLabel, label: t('statRank') },
  ];

  return (
    <View className="flex-1 bg-bg">
      {/* Header — matching match/[id].tsx idiom */}
      <View
        className="flex-row items-center gap-2 px-3"
        style={{ paddingTop: 12 + insets.top }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/leaderboard'))}
          style={({ pressed }) => [
            { opacity: pressed && !reduceMotion ? 0.7 : 1 },
            SHADOW_CARD,
          ]}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface"
        >
          <IcBack color={COLOR_TEXT} />
        </Pressable>
        <Text className="flex-1 text-center text-label text-text-2">{member.name}</Text>
        <View className="w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Centered avatar + name */}
        <View className="items-center gap-2 pb-[18px] pt-[14px]">
          <Avatar name={member.name} emoji={member.emoji} size="xl" />
          <Text className="text-heading text-text">{member.name}</Text>
        </View>

        {/* Stat tiles */}
        <StatTiles tiles={tiles} />

        {/* Pick history */}
        <HistoryList
          title={t('profileHistory')}
          games={games}
          guesses={memberGuesses}
          teams={teams}
          now={now}
          ptsFull={pool?.pts_full ?? 3}
          ptsPartial={pool?.pts_partial ?? 1}
          t={t}
        />
      </ScrollView>
    </View>
  );
}
