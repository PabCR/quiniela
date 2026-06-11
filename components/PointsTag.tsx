/* components/PointsTag.tsx — the scored-pick result chip (prototype PointsTag).
 *
 * Maps an engine Tag → a Chip:
 *   none     → void chip showing an em-dash "—"  (no pick / incomplete; NEVER 0)
 *   exact    → exact chip   "Exact · +N"  (soft white variant when requested)
 *   outcome  → outcome chip "Outcome · +N"
 *   draw     → outcome chip "Draw called · +N"
 *   miss     → void chip    "0"  (a genuine wrong pick scored zero — this 0 is
 *              distinct from the em-dash, which is the no-pick case)
 *
 * The em-dash-vs-0 distinction is the load-bearing rule (brief): a member who
 * never picked shows "—"; a member who picked wrong shows "0".
 */

import type { Translate } from '../lib/i18n';
import type { Tag } from '../lib/types';
import { Chip } from './Chip';

export function PointsTag({
  tag,
  pts,
  t,
  soft,
}: {
  tag: Tag;
  pts: number;
  t: Translate;
  /** Use the white-bg / green-text exact variant (final-card center). */
  soft?: boolean;
}) {
  if (tag === 'none') {
    return <Chip variant="void" label={t('tagNoPick')} />;
  }
  if (tag === 'exact') {
    return (
      <Chip
        variant={soft ? 'exact-soft' : 'exact'}
        label={t('tagExact') + ' · +' + pts}
        tabular
      />
    );
  }
  if (tag === 'outcome') {
    return <Chip variant="outcome" label={t('tagOutcome') + ' · +' + pts} tabular />;
  }
  if (tag === 'draw') {
    return <Chip variant="outcome" label={t('tagDraw') + ' · +' + pts} tabular />;
  }
  // miss — a real zero, not a no-pick.
  return <Chip variant="void" label="0" tabular />;
}
