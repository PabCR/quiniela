/* components/HistoryList.tsx — pick-history list (prototype HistoryList).
 *
 * Shows locked + void matches only (the ones a member can no longer edit),
 * newest first. One row per match:
 *   left   — flag pair (home flag · away flag)
 *   center — "HOME h–a AWAY" (em-dash when no pick) + sub-caption
 *            sub = result "Result h–a", "Void", "Live", or "Awaiting result"
 *   right  — PointsTag when final, void chip "—" when void, lock glyph otherwise
 *
 * The em-dash is always an actual "—" character, never "0".
 */

import { Text, View } from 'react-native';

import { IcLock } from './icons';
import { PointsTag } from './PointsTag';
import { Chip } from './Chip';
import { COLOR_TEXT_3, TABULAR } from './constants';
import { SHADOW_CARD } from '../lib/theme';
import {
  isLocked,
  resultOf,
  scorePick,
  statusOf,
} from '../lib/engine';
import type { Translate } from '../lib/i18n';
import type { Game, Guess, TeamsMap } from '../lib/types';

interface HistoryListProps {
  /** Section title rendered above the list. */
  title: string;
  games: Game[];
  /** The member's guesses keyed by game_id. */
  guesses: Record<number, Guess | undefined>;
  teams: TeamsMap;
  now: Date;
  ptsFull: number;
  ptsPartial: number;
  t: Translate;
}

export function HistoryList({
  title,
  games,
  guesses,
  teams,
  now,
  ptsFull,
  ptsPartial,
  t,
}: HistoryListProps) {
  // locked+void matches only, newest first
  const rows = games
    .filter((g) => {
      const st = statusOf(g, now);
      return isLocked(st) || st === 'void';
    })
    .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());

  return (
    <View className="mb-[14px] overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
      {/* Section header */}
      <Text className="px-4 pb-1 pt-[14px] text-label uppercase tracking-caps text-text-3">
        {title}
      </Text>

      {rows.length === 0 ? (
        <View className="flex-row items-center gap-[10px] px-4 py-[10px]">
          <Text className="text-body text-text-3">—</Text>
        </View>
      ) : null}

      {rows.map((game, idx) => {
        const st = statusOf(game, now);
        const guess = guesses[game.id];
        const result = resultOf(game);
        const scored =
          st === 'final' && result
            ? scorePick(
                guess
                  ? { home: guess.home, away: guess.away, advancer: guess.advancer }
                  : undefined,
                game,
                result,
                ptsFull,
                ptsPartial,
              )
            : null;

        const homeFlag = game.home ? (teams[game.home]?.flag ?? '') : '';
        const awayFlag = game.away ? (teams[game.away]?.flag ?? '') : '';
        const homeCode = game.home ?? '—';
        const awayCode = game.away ?? '—';

        // Score label: em-dash when no pick
        const pickLabel =
          guess != null
            ? `${homeCode} ${guess.home}–${guess.away} ${awayCode}`
            : `${homeCode} — ${awayCode}`;

        // Sub-caption
        let sub: string;
        if (st === 'void') {
          sub = t('voidTag');
        } else if (st === 'final' && result) {
          sub = t('resultRow') + ' ' + result.home + '–' + result.away;
        } else if (st === 'live') {
          sub = t('live');
        } else {
          sub = t('awaitingResult');
        }

        const isLast = idx === rows.length - 1;

        return (
          <View
            key={game.id}
            className={'flex-row items-center gap-[10px] px-4 py-[10px]' + (isLast ? '' : ' border-b border-surface-2')}
            style={{ minHeight: 50 }}
          >
            {/* Flags */}
            <Text style={{ fontSize: 17, letterSpacing: 2, lineHeight: 22 }}>
              {homeFlag} {awayFlag}
            </Text>

            {/* Pick label + sub */}
            <View className="flex-1 overflow-hidden">
              <Text
                className="text-body font-medium text-text"
                style={TABULAR}
                numberOfLines={1}
              >
                {pickLabel}
              </Text>
              <Text className="text-caption text-text-3">{sub}</Text>
            </View>

            {/* Right: points / void chip / lock */}
            {st === 'final' && scored ? (
              <PointsTag tag={scored.tag} pts={scored.pts} t={t} />
            ) : st === 'void' ? (
              <Chip variant="void" label="—" />
            ) : (
              <IcLock size={13} color={COLOR_TEXT_3} />
            )}
          </View>
        );
      })}
    </View>
  );
}
