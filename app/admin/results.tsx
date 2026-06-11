/* app/admin/results.tsx — Admin: Results entry list (brief §9, README §6).
 *
 * Two sections:
 *   Awaiting result — games with engine status 'awaiting' OR result_status
 *   'provisional' (auto-synced, not yet confirmed). Oldest first. Provisional
 *   rows show the provisional scores + a marked chip.
 *   Entered — confirmed (final) games newest first. Shows score + 'corrected'
 *   note when games.corrected. Each row has an Edit affordance.
 *
 * Empty awaiting section → t('adminNoAwaiting').
 * Tap any row → /admin/result/[id].
 */

import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Chip,
  IcBack,
  IcChev,
} from '../../components';
import { COLOR_TEXT, COLOR_TEXT_3, TABULAR } from '../../components/constants';
import {
  fmtDay,
  fmtTime,
  isProvisional,
  kickoffOf,
  resultOf,
  stageLabel,
  statusOf,
} from '../../lib/engine';
import { useGames, useTeams } from '../../lib/data';
import { useLang, useT } from '../../lib/providers';
import { useNow } from '../../lib/now';
import { SHADOW_CARD } from '../../lib/theme';
import type { Game } from '../../lib/types';

export default function AdminResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { lang } = useLang();
  const now = useNow();
  const games = useGames();
  const teams = useTeams();

  // Awaiting: status=awaiting OR result_status=provisional
  const awaiting = useMemo(() => {
    const out: Game[] = [];
    for (const g of games) {
      if (g.voided) continue;
      const st = statusOf(g, now);
      if (st === 'awaiting' || isProvisional(g)) {
        out.push(g);
      }
    }
    // oldest first
    return out.sort((a, b) => kickoffOf(a).getTime() - kickoffOf(b).getTime());
  }, [games, now]);

  // Entered: confirmed (final) games newest first
  const entered = useMemo(() => {
    return games
      .filter((g) => g.result_status === 'confirmed' && !g.voided)
      .sort((a, b) => kickoffOf(b).getTime() - kickoffOf(a).getTime());
  }, [games]);

  const goEntry = (id: number) => router.push(`/admin/result/${id}`);

  return (
    <View className="flex-1 bg-bg">
      {/* Back-button header */}
      <View
        className="flex-row items-center gap-2 px-3"
        style={{ paddingTop: 12 + insets.top }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/me'))}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, SHADOW_CARD]}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface"
        >
          <IcBack color={COLOR_TEXT} />
        </Pressable>
        <Text className="flex-1 text-center text-heading font-bold text-text">
          {t('meResults')}
        </Text>
        <View className="w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 40 + insets.bottom,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Awaiting section ── */}
        <Section label={t('adminAwaiting')}>
          {awaiting.length === 0 ? (
            <View className="px-4 py-3">
              <Text className="text-body text-text-3">{t('adminNoAwaiting')}</Text>
            </View>
          ) : (
            awaiting.map((g, i) => (
              <GameRow
                key={g.id}
                game={g}
                teams={teams}
                lang={lang}
                t={t}
                now={now}
                provisional={isProvisional(g)}
                showScore={isProvisional(g)}
                divider={i > 0}
                onPress={() => goEntry(g.id)}
              />
            ))
          )}
        </Section>

        {/* ── Entered section ── */}
        <Section label={t('adminEntered')}>
          {entered.length === 0 ? (
            <View className="px-4 py-3">
              <Text className="text-body text-text-3">{t('adminNoAwaiting')}</Text>
            </View>
          ) : (
            entered.map((g, i) => (
              <GameRow
                key={g.id}
                game={g}
                teams={teams}
                lang={lang}
                t={t}
                now={now}
                provisional={false}
                showScore={true}
                divider={i > 0}
                onPress={() => goEntry(g.id)}
              />
            ))
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

/* ---- Section card container ---- */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
      <Text className="px-4 pb-1 pt-[14px] text-label font-semibold uppercase tracking-[0.06em] text-text-3">
        {label}
      </Text>
      {children}
    </View>
  );
}

/* ---- Row for one game ---- */
function GameRow({
  game,
  teams,
  lang,
  t,
  now,
  provisional,
  showScore,
  divider,
  onPress,
}: {
  game: Game;
  teams: Record<string, import('../../lib/types').Team>;
  lang: import('../../lib/types').Lang;
  t: import('../../lib/i18n').Translate;
  now: Date;
  provisional: boolean;
  showScore: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  const homeTeam = game.home ? teams[game.home] : null;
  const awayTeam = game.away ? teams[game.away] : null;
  const ko = kickoffOf(game);
  const result = resultOf(game);

  const flagLine = [homeTeam?.flag ?? '', awayTeam?.flag ?? ''].join(' ');
  const codeLine = [game.home ?? '?', game.away ?? '?'].join(' – ');
  const dateLine = stageLabel(game.stage, t) + ' · ' + fmtDay(ko, lang, t, now) + ', ' + fmtTime(ko, lang);

  const scoreLine = showScore && (result ?? (provisional && game.score_home != null))
    ? (result
        ? `${game.home ?? ''} ${result.home}–${result.away} ${game.away ?? ''}`
        : `${game.home ?? ''} ${game.score_home}–${game.score_away} ${game.away ?? ''}`)
    : null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      className={
        'flex-row items-center gap-[11px] px-4 py-[11px]' +
        (divider ? ' border-t border-border' : '')
      }
    >
      {/* Flag pair */}
      <Text
        style={{ fontSize: 17, letterSpacing: 2 }}
        accessibilityLabel=""
        accessibilityHint=""
      >
        {flagLine}
      </Text>

      {/* Label block */}
      <View className="min-w-0 flex-1">
        {scoreLine ? (
          <Text
            className="text-body font-medium text-text"
            numberOfLines={1}
            style={TABULAR}
          >
            {scoreLine}
          </Text>
        ) : (
          <Text className="text-body font-medium text-text" numberOfLines={1}>
            {codeLine}
          </Text>
        )}
        <Text className="text-caption text-text-3" numberOfLines={1}>
          {dateLine}
        </Text>
        {game.corrected ? (
          <Text className="text-caption font-medium text-partial">
            {t('editedTag')}
          </Text>
        ) : null}
      </View>

      {/* State chip / edit label */}
      {provisional ? (
        <Chip variant="postponed" label={t('provisional')} />
      ) : showScore ? (
        <Text className="text-label text-text-3">{t('editResult')}</Text>
      ) : (
        <Chip variant="postponed" label={t('awaitingResult')} />
      )}

      <IcChev color={COLOR_TEXT_3} />
    </Pressable>
  );
}
