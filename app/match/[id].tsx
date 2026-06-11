/* app/match/[id].tsx — Match detail / pick entry (README §3, brief §F).
 *
 * Header: a 44px circular back button (white, shadow, IcBack) + a centered
 * "stage · day, time" line.
 *
 * Teams row: 64px circular flags + full team names; center =
 *   "vs"      pre-kickoff (editable)
 *   locked    your muted frozen pick (live/awaiting)
 *   result    the final score in text-display 40px
 *
 * Status subline per state: void chip / postponed chip (new date) / live chip
 * with minute (engine.liveMinute; KO renders "120+" when capped) / awaiting
 * text / final = my PointsTag + corrected note / locked = lock glyph + note.
 *
 * Editable (upcoming/postponed): two Steppers (FIFA-code labels). Autosave: any
 * change → optimistic local set (applyMyGuess) + "Saving…" → debounce 550ms →
 * upsert guesses on (pool_id,user_id,game_id) → SavedPill "Saved ✓" pop. On
 * failure: rollback optimistic state + inline error (if the RLS lock rejected
 * at kickoff, the next now-tick re-renders into the locked state). A KO draw
 * shows the AdvancerPicker (incomplete until chosen); changing away from a draw
 * clears the advancer (mirror of the prototype update()).
 *
 * Social row pre-lock: overlapping avatars (first 6) of who_picked + "n/m have
 * picked" + "Picks are revealed at kickoff".
 *
 * Post-lock: PicksTable (RLS reveals everyone post-kickoff; realtime flips it).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AdvancerPicker,
  Avatar,
  Chip,
  IcBack,
  IcLock,
  PicksTable,
  PointsTag,
  SavedPill,
  Stepper,
  type SaveState,
} from '../../components';
import { COLOR_LOCKED, COLOR_TEXT, TABULAR } from '../../components/constants';
import {
  fmtDay,
  fmtTime,
  isKO,
  kickoffOf,
  liveMinute,
  pickComplete,
  resultOf,
  scorePick,
  stageLabel,
  statusOf,
  teamName,
} from '../../lib/engine';
import {
  useGame,
  useGuessesForGame,
  useMembers,
  usePoolData,
  useWhoPicked,
  type PoolMember,
} from '../../lib/data';
import { useLang, useSession, useT } from '../../lib/providers';
import { useNow } from '../../lib/now';
import { SHADOW_CARD } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import type { Game, Guess, Lang, TeamCode, TeamsMap } from '../../lib/types';
import type { Translate } from '../../lib/i18n';

const SAVE_DEBOUNCE_MS = 550;

/** Local working pick shape (nullable scores while the user is mid-edit). */
interface DraftPick {
  home: number | null;
  away: number | null;
  advancer: TeamCode | null;
}

export default function MatchDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { lang } = useLang();
  const now = useNow(15_000); // slightly faster so live minute / lock feels current
  const { session } = useSession();
  const myId = session?.user.id ?? null;

  const { id } = useLocalSearchParams<{ id: string }>();
  const game = useGame(id);
  const { pool, teams, myGuesses, applyMyGuess } = usePoolData();
  const members = useMembers();
  const guesses = useGuessesForGame(game?.id);
  const who = useWhoPicked(game?.id);

  if (!game || !myId) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLOR_TEXT} />
      </View>
    );
  }

  return (
    <DetailBody
      game={game}
      myId={myId}
      poolId={pool?.id ?? null}
      ptsFull={pool?.pts_full ?? 3}
      ptsPartial={pool?.pts_partial ?? 1}
      myGuess={myGuesses[game.id]}
      guesses={guesses}
      pickers={who.pickers}
      refetchWho={who.refetch}
      members={members}
      teams={teams}
      applyMyGuess={applyMyGuess}
      now={now}
      lang={lang}
      t={t}
      insetTop={insets.top}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
    />
  );
}

function DetailBody({
  game,
  myId,
  poolId,
  ptsFull,
  ptsPartial,
  myGuess,
  guesses,
  pickers,
  refetchWho,
  members,
  teams,
  applyMyGuess,
  now,
  lang,
  t,
  insetTop,
  onBack,
}: {
  game: Game;
  myId: string;
  poolId: number | null;
  ptsFull: number;
  ptsPartial: number;
  myGuess: Guess | undefined;
  guesses: Record<string, Guess>;
  pickers: string[];
  refetchWho: () => void;
  members: PoolMember[];
  teams: TeamsMap;
  applyMyGuess: (gameId: number, guess: Guess | null) => void;
  now: Date;
  lang: Lang;
  t: Translate;
  insetTop: number;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const st = statusOf(game, now);
  const result = resultOf(game);
  const ko = kickoffOf(game);
  const editable = st === 'upcoming' || st === 'postponed';
  const locked = st === 'live' || st === 'awaiting';

  // Working draft, seeded from the saved guess.
  const [draft, setDraft] = useState<DraftPick>(() => ({
    home: myGuess?.home ?? null,
    away: myGuess?.away ?? null,
    advancer: myGuess?.advancer ?? null,
  }));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<DraftPick>({
    home: myGuess?.home ?? null,
    away: myGuess?.away ?? null,
    advancer: myGuess?.advancer ?? null,
  });

  // Re-seed when the server guess changes (realtime) but only while idle, to
  // avoid clobbering active input. Guarded on an actual value change so the
  // effect doesn't setState every render (no cascading re-renders).
  const seededKey = `${myGuess?.home ?? ''}|${myGuess?.away ?? ''}|${myGuess?.advancer ?? ''}`;
  const lastSeededKey = useRef<string | null>(null);
  useEffect(() => {
    if (saveState !== 'idle') return;
    if (lastSeededKey.current === seededKey) return;
    lastSeededKey.current = seededKey;
    const seeded: DraftPick = {
      home: myGuess?.home ?? null,
      away: myGuess?.away ?? null,
      advancer: myGuess?.advancer ?? null,
    };
    setDraft(seeded);
    lastSaved.current = seeded;
  }, [seededKey, saveState, myGuess]);

  const needsAdv =
    isKO(game) && draft.home != null && draft.away != null && draft.home === draft.away;

  const persist = useCallback(
    async (next: DraftPick) => {
      if (poolId == null) return;
      const isComplete = pickComplete(
        next.home != null && next.away != null
          ? { home: next.home, away: next.away, advancer: next.advancer }
          : undefined,
        game,
      );
      // Incomplete (e.g. KO draw without advancer) stays local until completed.
      if (!isComplete || next.home == null || next.away == null) {
        setSaveState('idle');
        return;
      }

      const optimistic: Guess = {
        pool_id: poolId,
        user_id: myId,
        game_id: game.id,
        home: next.home,
        away: next.away,
        advancer: next.advancer,
        points: null,
        tag: null,
        updated_at: new Date().toISOString(),
      };
      applyMyGuess(game.id, optimistic);

      const { error: upErr } = await supabase.from('guesses').upsert(
        {
          pool_id: poolId,
          user_id: myId,
          game_id: game.id,
          home: next.home,
          away: next.away,
          advancer: next.advancer,
        },
        { onConflict: 'pool_id,user_id,game_id' },
      );

      if (upErr) {
        // Roll back optimistic state + surface the error. A kickoff/RLS rejection
        // re-renders into the locked state on the next now-tick.
        applyMyGuess(game.id, myGuess ?? null);
        setDraft(lastSaved.current);
        setSaveState('idle');
        setError(upErr.message);
        return;
      }

      lastSaved.current = next;
      setError(null);
      setSaveState('saved');
      refetchWho(); // we may have just become a picker
    },
    [applyMyGuess, game, myGuess, myId, poolId, refetchWho],
  );

  const update = useCallback(
    (patch: Partial<DraftPick>) => {
      setDraft((prev) => {
        const next: DraftPick = { ...prev, ...patch };
        // Non-draw pick implies its own winner: clear any stray advancer.
        if (next.home != null && next.away != null && next.home !== next.away) {
          next.advancer = null;
        }
        setSaveState('saving');
        setError(null);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persist(next), SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const stageLine =
    stageLabel(game.stage, t) + ' · ' + fmtDay(ko, lang, t, now) + ', ' + fmtTime(ko, lang);

  const liveMin = useMemo(() => {
    const m = liveMinute(game, now);
    // KO can exceed 90; engine caps at 120 — render "120+" when capped.
    return isKO(game) && m >= 120 ? '120+' : String(m);
  }, [game, now]);

  const pickedMemberObjs = useMemo(
    () => members.filter((mb) => pickers.includes(mb.user_id)),
    [members, pickers],
  );

  const myScore = result
    ? scorePick(
        myGuess ? { home: myGuess.home, away: myGuess.away, advancer: myGuess.advancer } : undefined,
        game,
        result,
        ptsFull,
        ptsPartial,
      )
    : null;

  return (
    <View className="flex-1 bg-bg">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-3" style={{ paddingTop: 12 + insetTop }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={onBack}
          style={({ pressed }) => [{ opacity: pressed && !reduceMotion ? 0.7 : 1 }, SHADOW_CARD]}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface"
        >
          <IcBack color={COLOR_TEXT} />
        </Pressable>
        <Text className="flex-1 text-center text-label text-text-2">{stageLine}</Text>
        <View className="w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 + insetTop }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Teams */}
        <View className="flex-row items-start justify-between gap-[6px] px-2 pb-[6px] pt-[18px]">
          <TeamColumn code={game.home} teams={teams} lang={lang} />
          <View className="items-center justify-center">
            {st === 'final' && result ? (
              <Text
                className="text-text"
                style={[{ fontSize: 40, fontWeight: '700', paddingTop: 10 }, TABULAR]}
              >
                {result.home}–{result.away}
              </Text>
            ) : locked && myGuess ? (
              <Text
                style={[
                  { fontSize: 40, fontWeight: '700', paddingTop: 10, color: COLOR_LOCKED },
                  TABULAR,
                ]}
              >
                {myGuess.home}–{myGuess.away}
              </Text>
            ) : (
              <Text className="text-label text-text-3" style={{ paddingTop: 22 }}>
                vs
              </Text>
            )}
          </View>
          <TeamColumn code={game.away} teams={teams} lang={lang} />
        </View>

        {/* Status subline */}
        <View className="items-center gap-[7px] pb-[10px] pt-[2px]">
          {st === 'void' ? <Chip variant="void" label={t('voidTag')} /> : null}
          {st === 'postponed' ? (
            <Chip
              variant="postponed"
              label={t('newDate', { d: fmtDay(ko, lang, t, now) + ', ' + fmtTime(ko, lang) })}
            />
          ) : null}
          {st === 'live' ? (
            <Chip variant="live" live label={t('live') + ' · ' + liveMin + '′'} />
          ) : null}
          {st === 'awaiting' ? (
            <Text className="text-label text-text-2">{t('awaitingResult')}</Text>
          ) : null}
          {st === 'final' && myScore ? <PointsTag tag={myScore.tag} pts={myScore.pts} t={t} /> : null}
          {st === 'final' && game.corrected ? (
            <Chip variant="corrected" label={t('corrected')} />
          ) : null}
          {locked ? (
            <View className="flex-row items-center gap-[6px]">
              <IcLock size={13} color={COLOR_LOCKED} />
              <Text className="text-label text-text-2">
                {myGuess ? t('lockedNote') : t('tagNoPick')}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Editable: steppers + autosave + advancer + social */}
        {editable ? (
          <>
            <View className="flex-row gap-3 pb-1 pt-2">
              <Stepper
                label={game.home ?? '—'}
                value={draft.home}
                onChange={(v) => update({ home: v, away: draft.away == null ? 0 : draft.away })}
              />
              <Stepper
                label={game.away ?? '—'}
                value={draft.away}
                onChange={(v) => update({ away: v, home: draft.home == null ? 0 : draft.home })}
              />
            </View>
            <View className="items-center pt-2">
              <SavedPill state={saveState} t={t} />
              {error ? (
                <Text className="mt-1 text-caption text-live" accessibilityRole="alert">
                  {'⚠ ' + error}
                </Text>
              ) : null}
            </View>

            {needsAdv && game.home && game.away ? (
              <AdvancerPicker
                home={game.home}
                away={game.away}
                selected={draft.advancer}
                onSelect={(code) => update({ advancer: code })}
                teams={teams}
                t={t}
              />
            ) : null}

            {/* Social row (who, never what) */}
            <View className="flex-row items-center justify-center gap-[10px] pb-1 pt-[14px]">
              <View className="flex-row">
                {pickedMemberObjs.slice(0, 6).map((mb, i) => (
                  <View
                    key={mb.user_id}
                    style={{ marginLeft: i === 0 ? 0 : -8 }}
                    className="rounded-full border-2 border-bg"
                  >
                    <Avatar name={mb.name} emoji={mb.emoji} />
                  </View>
                ))}
              </View>
              <Text className="text-label text-text-2">
                {t('havePicked', { n: pickers.length, m: members.length })}
              </Text>
            </View>
            <Text className="pt-[2px] text-center text-caption text-text-3">{t('picksHidden')}</Text>
          </>
        ) : null}

        {/* Post-lock: everyone's picks (void → no points column) */}
        {!editable ? (
          <PicksTable
            game={game}
            members={members}
            guesses={guesses}
            meId={myId}
            teams={teams}
            t={t}
            ptsFull={ptsFull}
            ptsPartial={ptsPartial}
            withPoints={st !== 'void'}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

/* A 64px circular flag + the full (balanced) team name. */
function TeamColumn({
  code,
  teams,
  lang,
}: {
  code: TeamCode | null;
  teams: TeamsMap;
  lang: Lang;
}) {
  return (
    <View className="flex-1 items-center gap-[7px]">
      <View
        className="h-16 w-16 items-center justify-center rounded-full bg-surface"
        style={SHADOW_CARD}
      >
        <Text style={{ fontSize: 34 }}>{code ? teams[code]?.flag ?? '' : ''}</Text>
      </View>
      <Text className="text-center text-heading text-text">{teamName(code, teams, lang)}</Text>
    </View>
  );
}
