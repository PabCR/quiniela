/* components/MatchCard.tsx — THE match card (README §2, prototype MatchCard).
 *
 * Drives all 7 states + the awaiting status from engine.statusOf + pickComplete
 * + scorePick. No state is encoded by color alone — every wash pairs with an
 * icon/label (lock glyph, "Live", em-dash, points tag, "Void", "Postponed").
 *
 * Layout: a surface card (rounded-xl, card shadow). Body is a 3-col grid
 * [64 team | 1fr center | 64 team] with 46px circular flag chips (own shadow on
 * white) + FIFA codes, a per-state center, and a centered dot-separated meta
 * line. Unpicked upcoming/postponed cards append a PendingStrip.
 *
 * Washes (token bg, never a raw color):
 *   live    live-soft
 *   exact   exact-soft     (final, my pick exact)
 *   partial partial-soft   (final, my pick outcome/draw)
 *   void    void-soft + hairline border, no shadow, grayscaled flags
 *
 * Press scale 0.985 (reduced motion → none). The whole card is the tap target.
 *
 * em-dash discipline: a missing pick renders "—", never "0".
 */

import { Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { Translate } from '../lib/i18n';
import {
  fmtCountdown,
  fmtDay,
  fmtTime,
  kickoffOf,
  liveMinute,
  pickComplete,
  resultOf,
  scorePick,
  stageLabel,
  statusOf,
} from '../lib/engine';
import { SHADOW_CARD } from '../lib/theme';
import type { Game, Guess, Lang, TeamCode, TeamsMap } from '../lib/types';
import { Chip } from './Chip';
import { COLOR_LOCKED, TABULAR } from './constants';
import { IcLock } from './icons';
import { PendingStrip } from './PendingStrip';
import { PointsTag } from './PointsTag';

const URGENT_MS = 2 * 3_600_000; // <2h to kickoff = urgent

/** A circular flag chip + FIFA code. Grayscaled-ish for void via dim opacity. */
function Team({
  code,
  teams,
  void: isVoid,
}: {
  code: TeamCode | null;
  teams: TeamsMap;
  void?: boolean;
}) {
  const flag = code ? teams[code]?.flag ?? '' : '';
  return (
    <View className="items-center gap-[5px]" style={{ width: 64 }}>
      <View
        className={
          'h-[46px] w-[46px] items-center justify-center rounded-full bg-surface ' +
          (isVoid ? 'border border-border opacity-75' : '')
        }
        style={isVoid ? undefined : SHADOW_CARD}
      >
        <Text style={{ fontSize: 24, opacity: isVoid ? 0.55 : 1 }}>{flag}</Text>
      </View>
      <Text
        className={
          'text-label uppercase tracking-[0.06em] ' + (isVoid ? 'text-text-3' : 'text-text')
        }
      >
        {code ?? '—'}
      </Text>
    </View>
  );
}

/** The centered dot-separated meta line. Items may be strings or nodes. */
function MetaLine({ items, dim }: { items: React.ReactNode[]; dim?: boolean }) {
  return (
    <View className="min-h-[18px] flex-row flex-wrap items-center justify-center gap-[7px]">
      {items.map((item, i) => (
        <View key={i} className="flex-row items-center gap-[7px]">
          {i > 0 ? <Text className="text-label text-text-2 opacity-50">·</Text> : null}
          {typeof item === 'string' ? (
            <Text className={'text-label ' + (dim ? 'text-text-3' : 'text-text-2')}>{item}</Text>
          ) : (
            item
          )}
        </View>
      ))}
    </View>
  );
}

export function MatchCard({
  game,
  myPick,
  teams,
  now,
  ptsFull,
  ptsPartial,
  lang,
  t,
  onOpen,
}: {
  game: Game;
  myPick: Guess | undefined;
  teams: TeamsMap;
  now: Date;
  ptsFull: number;
  ptsPartial: number;
  lang: Lang;
  t: Translate;
  onOpen: () => void;
}) {
  const reduceMotion = useReducedMotion();

  const st = statusOf(game, now);
  const result = resultOf(game);
  const complete = pickComplete(myPick, game);
  const hasNums = myPick != null;
  const ko = kickoffOf(game);
  const stage = stageLabel(game.stage, t);
  const dayTime = fmtDay(ko, lang, t, now) + ', ' + fmtTime(ko, lang);
  const scoreStr = (g: Guess) => g.home + ' – ' + g.away;

  const urgent =
    st === 'upcoming' && !complete && ko.getTime() - now.getTime() < URGENT_MS;

  // wash class, center node, meta items, optional strip
  let wash = 'bg-surface';
  let cardExtra = '';
  let center: React.ReactNode = null;
  const meta: React.ReactNode[] = [];
  let strip: React.ReactNode = null;
  let voidLook = false;

  if (st === 'upcoming' || st === 'postponed') {
    if (complete && myPick) {
      center = (
        <View className="items-center gap-[6px]">
          <Text className="text-caption font-semibold uppercase tracking-[0.06em] text-text-3">
            {t('yourPick')}
          </Text>
          <Text className="text-text" style={[{ fontSize: 30, fontWeight: '700' }, TABULAR]}>
            {scoreStr(myPick)}
          </Text>
        </View>
      );
      if (st === 'postponed') {
        meta.push(
          <Chip
            key="p"
            variant="postponed"
            label={t('newDate', { d: dayTime })}
          />,
          stage,
        );
      } else {
        meta.push(stage, dayTime, t('edit'));
      }
    } else {
      if (st === 'postponed') {
        center = (
          <View className="items-center gap-[6px]">
            <Text className="text-caption font-semibold uppercase tracking-[0.06em] text-text-3">
              {t('postponed')}
            </Text>
            <Chip variant="postponed" label={t('newDate', { d: dayTime })} />
          </View>
        );
        meta.push(stage, t('pickOpen'));
      } else {
        center = (
          <Text
            className="font-semibold text-text-disabled"
            style={[{ fontSize: 30 }, TABULAR]}
          >
            – : –
          </Text>
        );
        meta.push(stage, dayTime);
      }
      // KO draw needs an advancer? show that prompt instead of the countdown.
      const needsAdv = hasNums && !complete;
      strip = (
        <PendingStrip
          leftText={needsAdv ? t('advNeeded') : t('closesIn', { t: fmtCountdown(ko, lang, now) })}
          buttonLabel={t('makePick')}
          urgent={urgent}
        />
      );
    }
  } else if (st === 'live') {
    wash = 'bg-live-soft';
    center = (
      <View className="items-center gap-[6px]">
        <Chip variant="live" live label={t('live') + ' · ' + liveMinute(game, now) + '′'} />
        {hasNums && myPick ? (
          <View className="flex-row items-center gap-1">
            <IcLock size={15} color={COLOR_LOCKED} />
            <Text
              style={[{ fontSize: 30, fontWeight: '700', color: COLOR_LOCKED }, TABULAR]}
            >
              {scoreStr(myPick)}
            </Text>
          </View>
        ) : (
          <Text className="font-semibold text-text-disabled" style={{ fontSize: 30 }}>
            —
          </Text>
        )}
      </View>
    );
    meta.push(stage, hasNums ? t('lockedNote') : t('tagNoPick'));
  } else if (st === 'awaiting') {
    center = (
      <View className="items-center gap-[6px]">
        <Text className="text-caption font-semibold uppercase tracking-[0.06em] text-text-3">
          {t('awaitingResult')}
        </Text>
        {hasNums && myPick ? (
          <View className="flex-row items-center gap-1">
            <IcLock size={15} color={COLOR_LOCKED} />
            <Text
              style={[{ fontSize: 30, fontWeight: '700', color: COLOR_LOCKED }, TABULAR]}
            >
              {scoreStr(myPick)}
            </Text>
          </View>
        ) : (
          <Text className="font-semibold text-text-disabled" style={{ fontSize: 30 }}>
            —
          </Text>
        )}
      </View>
    );
    meta.push(stage, fmtDay(ko, lang, t, now));
  } else if (st === 'final' && result) {
    const s = scorePick(myPick, game, result, ptsFull, ptsPartial);
    const tag = s?.tag ?? 'none';
    wash =
      tag === 'exact'
        ? 'bg-exact-soft'
        : tag === 'outcome' || tag === 'draw'
          ? 'bg-partial-soft'
          : 'bg-surface';
    center = (
      <View className="items-center gap-[6px]">
        <Text className="text-caption font-semibold uppercase tracking-[0.06em] text-text-3">
          {t('final')}
        </Text>
        <Text className="text-text" style={[{ fontSize: 30, fontWeight: '700' }, TABULAR]}>
          {result.home + ' – ' + result.away}
        </Text>
        <PointsTag tag={tag} pts={s?.pts ?? 0} t={t} soft={tag === 'exact'} />
      </View>
    );
    meta.push(
      stage,
      complete && myPick ? t('youPicked', { s: scoreStr(myPick) }) : t('tagNoPick'),
    );
    if (game.corrected) {
      meta.push(<Chip key="c" variant="corrected" label={t('editedTag')} />);
    }
  } else {
    // void
    wash = 'bg-void-soft';
    cardExtra = 'border border-border';
    voidLook = true;
    center = (
      <View className="items-center gap-[6px]">
        <Text className="font-semibold text-text-disabled" style={{ fontSize: 30 }}>
          —
        </Text>
        <Chip variant="void" label={t('voidTag')} />
      </View>
    );
    meta.push(stage, t('played', { d: fmtDay(ko, lang, t, now) }));
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      // Press scale 0.985 via Pressable's pressed state (reduced motion → none).
      // Using the native pressed flag keeps this off the reanimated path so the
      // whole card is one simple, lint-clean tappable surface.
      style={({ pressed }) => ({
        transform: [{ scale: pressed && !reduceMotion ? 0.985 : 1 }],
      })}
    >
      <View
        className={'mb-3 overflow-hidden rounded-xl ' + wash + ' ' + cardExtra}
        style={voidLook ? undefined : SHADOW_CARD}
      >
        <View className="gap-[9px] px-4 pb-[13px] pt-4">
          <View className="flex-row items-center justify-between">
            <Team code={game.home} teams={teams} void={voidLook} />
            <View className="min-h-[64px] flex-1 items-center justify-center gap-[6px]">
              {center}
            </View>
            <Team code={game.away} teams={teams} void={voidLook} />
          </View>
          <MetaLine items={meta} dim={voidLook} />
        </View>
        {strip}
      </View>
    </Pressable>
  );
}
