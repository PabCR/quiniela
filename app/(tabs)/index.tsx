/* app/(tabs)/index.tsx — Matches (home), README §2.
 *
 * ScreenHeader "Matches" + PendingBadge (tap → pending filter) + FilterChips
 * (All / My pending). A SectionList grouped by DEVICE-LOCAL date: TODAY pinned
 * first ("TODAY · <date>"), then upcoming days ascending, then past days
 * descending (prototype screens-matches.jsx sort). Each card is a MatchCard;
 * countdowns/status come off a ticking useNow. Empty filtered state = 🎉 +
 * all-picked.
 *
 * Data: usePoolData (games/teams/myGuesses/pool). Realtime + focus refetch are
 * wired in the provider; we additionally refetch on focus here as the brief
 * fallback.
 */

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  COLOR_TEXT,
  DayLabel,
  EmptyState,
  FilterChips,
  MatchCard,
  PendingBadge,
  ScreenHeader,
  type FilterOption,
} from '../../components';
import { fmtDay } from '../../lib/engine';
import { usePendingGames, usePoolData } from '../../lib/data';
import { useLang, useT } from '../../lib/providers';
import { useNow } from '../../lib/now';
import type { Game } from '../../lib/types';

type Filter = 'all' | 'pending';

interface DaySection {
  key: string;
  title: string;
  data: Game[];
}

/** Local-day key, used to bucket games by the device-local calendar day. */
function dayKey(d: Date): string {
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

export default function MatchesScreen() {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const now = useNow();
  const { games, teams, myGuesses, pool, loading, refetch } = usePoolData();
  const pending = usePendingGames();
  const pendingIds = useMemo(() => new Set(pending.map((g) => g.id)), [pending]);

  const [filter, setFilter] = useState<Filter>('all');

  // Re-fetch when the screen regains focus (brief §9 fallback to realtime).
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const sections = useMemo<DaySection[]>(() => {
    const list = filter === 'pending' ? games.filter((g) => pendingIds.has(g.id)) : games;

    // Bucket by local day.
    const groups = new Map<string, Game[]>();
    for (const g of list) {
      const k = dayKey(new Date(g.kickoff));
      const arr = groups.get(k);
      if (arr) arr.push(g);
      else groups.set(k, [g]);
    }

    const todayKey = dayKey(now);
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === todayKey) return -1;
      if (b === todayKey) return 1;
      const da = new Date(groups.get(a)![0].kickoff).getTime();
      const db = new Date(groups.get(b)![0].kickoff).getTime();
      const fa = da >= now.getTime();
      const fb = db >= now.getTime();
      if (fa !== fb) return fa ? -1 : 1; // future before past
      return fa ? da - db : db - da; // upcoming asc, past desc
    });

    return keys.map((k) => {
      const data = groups.get(k)!.slice().sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));
      const first = new Date(data[0].kickoff);
      const monthDay = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', {
        day: 'numeric',
        month: 'short',
      }).format(first);
      return {
        key: k,
        title: (fmtDay(first, lang, t, now) + ' · ' + monthDay).toUpperCase(),
        data,
      };
    });
  }, [games, filter, pendingIds, now, lang, t]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLOR_TEXT} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title={t('tabMatches')}
        right={
          <PendingBadge
            count={pending.length}
            t={t}
            onPress={() => setFilter(pending.length ? 'pending' : 'all')}
          />
        }
        below={
          <FilterChips<Filter>
            value={filter}
            onChange={setFilter}
            options={
              [
                { value: 'all', label: t('filterAll') },
                { value: 'pending', label: t('filterPending') },
              ] satisfies FilterOption<Filter>[]
            }
          />
        }
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <DayLabel>{(section as DaySection).title}</DayLabel>}
        renderItem={({ item }) => (
          <MatchCard
            game={item}
            myPick={myGuesses[item.id]}
            teams={teams}
            now={now}
            ptsFull={pool?.pts_full ?? 3}
            ptsPartial={pool?.pts_partial ?? 1}
            lang={lang}
            t={t}
            onOpen={() => router.push(`/match/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <EmptyState emoji="🎉" title={t('pendingNone')} />
        }
      />
    </View>
  );
}
