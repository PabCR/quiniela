/* app/(tabs)/me.tsx — Me screen (README §5, brief §9).
 *
 * Content (top → bottom):
 *   - xl Avatar (tap → inline 5-col emoji grid of 22 prototype emojis; choosing
 *     updates profiles.emoji via Supabase + provider refresh)
 *   - Name + t('meAvatar') caption
 *   - StatTiles: Points / Exact scores / Position (T- prefix when tied)
 *   - Language segmented control (Español / English) wired to useLang().setLang
 *   - HistoryList (t('meHistory')) — MY pick history
 *   - Sign out row (provider signOut, navigate to /auth after)
 *   - Admin section (membership.role === 'admin' only):
 *       t('meResults') → /admin/results
 *       t('meMembers') → /admin/members
 */

import { useState, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, IcChev, ScreenHeader } from '../../components';
import { Q_EMOJIS as EMOJIS } from '../../components/constants';
import { HistoryList } from '../../components/HistoryList';
import { StatTiles } from '../../components/StatTiles';
import { SHADOW_CARD } from '../../lib/theme';
import { standingsWithMovement } from '../../lib/engine';
import { useGames, useMembers, usePool, usePoolData } from '../../lib/data';
import { useLang, useSession, useT } from '../../lib/providers';
import { useNow } from '../../lib/now';
import { supabase } from '../../lib/supabase';


export default function MeScreen() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { profile, membership, signOut, refresh } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow();

  const games = useGames();
  const members = useMembers();
  const pool = usePool();
  const { guessesByGame, myGuesses, teams } = usePoolData();

  const [picking, setPicking] = useState(false);
  const [savingEmoji, setSavingEmoji] = useState(false);
  // Drives the segmented-control highlight independently of the active `lang`,
  // so the slider moves on tap before the refresh that actually applies it.
  const [pendingLang, setPendingLang] = useState<import('../../lib/types').Lang | null>(null);

  // Build AllPicks map for standings computation
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

  const myId = profile?.id;

  // Standings row for me
  const myStandingRow = useMemo(() => {
    if (!members.length || !myId) return null;
    const rows = standingsWithMovement(
      members.map((m) => ({ id: m.user_id })),
      games,
      allPicks,
      now,
      pool?.pts_full ?? 3,
      pool?.pts_partial ?? 1,
    );
    return rows.find((r) => r.id === myId) ?? null;
  }, [members, games, allPicks, now, pool, myId]);

  // My guesses keyed by game id (for history)
  const myGuessesByGameId = useMemo(() => {
    const out: Record<number, import('../../lib/types').Guess | undefined> = {};
    for (const [gameId, g] of Object.entries(myGuesses)) {
      out[Number(gameId)] = g;
    }
    return out;
  }, [myGuesses]);

  const pts = myStandingRow?.pts ?? 0;
  const exact = myStandingRow?.exact ?? 0;
  const rankLabel = myStandingRow
    ? (myStandingRow.tied ? 'T-' : '') + myStandingRow.rank
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

  const isAdmin = membership?.role === 'admin';

  async function handlePickEmoji(emoji: string) {
    if (!profile || savingEmoji) return;
    setSavingEmoji(true);
    await supabase.from('profiles').update({ emoji }).eq('id', profile.id);
    await refresh();
    setSavingEmoji(false);
    setPicking(false);
  }

  function handlePickLang(next: import('../../lib/types').Lang) {
    // No-op on the already-active language; ignore taps mid-refresh.
    if (next === lang || pendingLang) return;
    // Move the highlight immediately, then confirm before applying.
    setPendingLang(next);
    Alert.alert(t('langRefreshTitle'), t('langRefreshBody'), [
      {
        text: t('cancel'),
        style: 'cancel',
        onPress: () => setPendingLang(null),
      },
      {
        text: t('actionRefresh'),
        onPress: async () => {
          await setLang(next); // write-through (awaits the DB commit)
          await refresh(); // refetch profile → derived `lang` flips → UI re-renders
          setPendingLang(null);
        },
      },
    ]);
  }

  async function handleSignOut() {
    Alert.alert(
      t('signOutConfirm'),
      t('signOutBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('signOut'),
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/');
          },
        },
      ],
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={t('tabMe')} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 40 + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + name + caption */}
        <View className="items-center gap-2 pb-4 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('meAvatar')}
            onPress={() => setPicking((p) => !p)}
            style={{ padding: 0 }}
          >
            <Avatar name={profile?.name} emoji={profile?.emoji} size="xl" />
          </Pressable>
          <Text className="text-heading text-text">{profile?.name ?? ''}</Text>
          <Text className="text-caption text-text-3">{t('meAvatar')}</Text>
        </View>

        {/* Inline emoji picker */}
        {picking ? (
          <View className="mb-6 mt-0 flex-row flex-wrap gap-[10px]">
            {EMOJIS.map((e) => {
              const selected = profile?.emoji === e;
              return (
                <Pressable
                  key={e}
                  accessibilityRole="button"
                  accessibilityLabel={e}
                  accessibilityState={{ selected }}
                  onPress={() => handlePickEmoji(e)}
                  disabled={savingEmoji}
                  className={
                    'items-center justify-center rounded-md border-2 ' +
                    (selected
                      ? 'border-accent bg-accent-soft'
                      : 'border-transparent bg-surface')
                  }
                  style={[SHADOW_CARD, { width: '18%', aspectRatio: 1 }]}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Stat tiles */}
        <StatTiles tiles={tiles} />

        {/* Language section */}
        <View className="mb-[14px] overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
          <Text className="px-4 pb-1 pt-[14px] text-label uppercase tracking-caps text-text-3">
            {t('meLanguage')}
          </Text>
          <View className="px-4 pb-4 pt-[10px]">
            {/* Segmented control */}
            <View className="flex-row rounded-pill bg-surface-2 p-[3px]" style={{ gap: 2 }}>
              {(['es', 'en'] as const).map((l) => {
                const active = (pendingLang ?? lang) === l;
                return (
                  <Pressable
                    key={l}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => handlePickLang(l)}
                    className={
                      'flex-1 items-center justify-center rounded-pill ' +
                      (active ? 'bg-accent' : 'bg-transparent')
                    }
                    style={{ minHeight: 36, paddingVertical: 8 }}
                  >
                    <Text
                      className={
                        'text-label font-semibold ' +
                        (active ? 'text-on-accent' : 'text-text-2')
                      }
                    >
                      {l === 'es' ? 'Español' : 'English'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* My pick history */}
        <HistoryList
          title={t('meHistory')}
          games={games}
          guesses={myGuessesByGameId}
          teams={teams}
          now={now}
          ptsFull={pool?.pts_full ?? 3}
          ptsPartial={pool?.pts_partial ?? 1}
          t={t}
        />

        {/* Sign out */}
        <View className="mb-[14px] overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
          <Pressable
            accessibilityRole="button"
            onPress={handleSignOut}
            className="flex-row items-center gap-[11px] px-4"
            style={{ minHeight: 52 }}
          >
            <Text className="flex-1 text-body text-live">{t('signOut')}</Text>
          </Pressable>
        </View>

        {/* Admin section (admin role only) */}
        {isAdmin ? (
          <View className="mb-[14px] overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
            <Text className="px-4 pb-1 pt-[14px] text-label uppercase tracking-caps text-text-3">
              {t('meAdmin')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push('/admin/results');
              }}
              className="flex-row items-center gap-[11px] px-4"
              style={{ minHeight: 52, borderTopWidth: 0 }}
            >
              <Text className="flex-1 text-body text-text">{t('meResults')}</Text>
              <IcChev />
            </Pressable>
            <View className="mx-4 border-t border-surface-2" />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                
                router.push('/admin/members');
              }}
              className="flex-row items-center gap-[11px] px-4"
              style={{ minHeight: 52 }}
            >
              <Text className="flex-1 text-body text-text">{t('meMembers')}</Text>
              <IcChev />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
