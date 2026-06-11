/* components/PicksTable.tsx — everyone's-picks table (prototype .ptbl / PicksTable).
 *
 * Post-lock view: one row per active member —
 *   avatar · name (+ "You" chip, accent-soft row bg for me) · their pick "h–a"
 *   (+ a small advancer flag if present) or an em-dash (text-disabled, NEVER 0)
 *   · points column.
 *
 * Points column:
 *   before a result  → a lock glyph (picks revealed, result pending)
 *   after a result   → each member's PointsTag, table sorted by points desc.
 *     Points/tag come from the SERVER-computed guess (guess.points / guess.tag)
 *     when present; engine.scorePick is the display fallback for an optimistic
 *     gap (e.g. a just-confirmed result before the trigger echo lands).
 *
 * Void → render WITHOUT the points column (withPoints = false).
 *
 * Members with no visible guess row show the em-dash. A member's own row is
 * always present (their pick is always visible to them).
 */

import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { Translate } from '../lib/i18n';
import { resultOf, scorePick } from '../lib/engine';
import type { Game, Guess, ScoredTag, Tag, TeamsMap } from '../lib/types';
import { Avatar } from './Avatar';
import { Chip } from './Chip';
import { COLOR_LOCKED, TABULAR } from './constants';
import { IcLock } from './icons';
import { PointsTag } from './PointsTag';
import type { PoolMember } from '../lib/data';

interface RowData {
  member: PoolMember;
  guess: Guess | undefined;
  tag: Tag;
  pts: number;
}

export function PicksTable({
  game,
  members,
  guesses,
  meId,
  teams,
  t,
  ptsFull,
  ptsPartial,
  withPoints,
}: {
  game: Game;
  members: PoolMember[];
  /** userId → Guess for this game (RLS-visible set). */
  guesses: Record<string, Guess>;
  meId: string;
  teams: TeamsMap;
  t: Translate;
  ptsFull: number;
  ptsPartial: number;
  /** false on void → no points column. */
  withPoints: boolean;
}) {
  const result = resultOf(game);

  const rows = useMemo<RowData[]>(() => {
    const out: RowData[] = members.map((member) => {
      const guess = guesses[member.user_id];
      // Prefer the server-computed tag/points; fall back to the engine for an
      // optimistic display gap. Both are display-only — server is the source of
      // truth and arrives via realtime.
      let tag: Tag = 'none';
      let pts = 0;
      if (result) {
        if (guess?.tag) {
          tag = guess.tag as ScoredTag;
          pts = guess.points ?? 0;
        } else {
          const s = scorePick(
            guess ? { home: guess.home, away: guess.away, advancer: guess.advancer } : undefined,
            game,
            result,
            ptsFull,
            ptsPartial,
          );
          tag = s?.tag ?? 'none';
          pts = s?.pts ?? 0;
        }
      }
      return { member, guess, tag, pts };
    });

    if (result) {
      out.sort((a, b) => b.pts - a.pts);
    }
    return out;
  }, [members, guesses, game, result, ptsFull, ptsPartial]);

  return (
    <View className="mt-[14px] overflow-hidden rounded-lg bg-surface" style={{ elevation: 2 }}>
      <Text className="px-4 pb-[6px] pt-[14px] text-left text-label uppercase tracking-[0.06em] text-text-3">
        {t('everyonesPicks')}
      </Text>
      {rows.map(({ member, guess, tag, pts }, i) => {
        const isMe = member.user_id === meId;
        const hasPick = guess != null;
        return (
          <View
            key={member.user_id}
            className={
              'min-h-12 flex-row items-center gap-[10px] px-4 py-[9px] ' +
              (isMe ? 'bg-accent-soft ' : '') +
              (i > 0 ? 'border-t border-border' : '')
            }
          >
            <Avatar name={member.name} emoji={member.emoji} />
            <View className="flex-1 flex-row items-center gap-[7px]">
              <Text
                numberOfLines={1}
                className="flex-shrink text-body font-medium text-text"
              >
                {member.name}
              </Text>
              {isMe ? <Chip variant="void" label={t('youChip')} /> : null}
            </View>
            <View className="min-w-[44px] flex-row items-center justify-end gap-1">
              {hasPick && guess ? (
                <>
                  <Text
                    className="font-semibold text-text"
                    style={[{ fontSize: 17 }, TABULAR]}
                  >
                    {guess.home + '–' + guess.away}
                  </Text>
                  {guess.advancer ? (
                    <Text style={{ fontSize: 12 }}>{teams[guess.advancer]?.flag ?? ''}</Text>
                  ) : null}
                </>
              ) : (
                <Text
                  className="font-medium text-text-disabled"
                  style={[{ fontSize: 17 }, TABULAR]}
                >
                  —
                </Text>
              )}
            </View>
            {withPoints ? (
              <View className="min-w-[86px] flex-row justify-end">
                {result ? (
                  <PointsTag tag={tag} pts={pts} t={t} />
                ) : (
                  <IcLock size={14} color={COLOR_LOCKED} />
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
