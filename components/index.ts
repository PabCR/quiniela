/* components/index.ts — the shared UI vocabulary barrel.
 *
 * Re-exports every reusable component so screens (and later Leaderboard / Me /
 * Admin agents) import from one place: `import { MatchCard, Stepper } from
 * '@/components'`.
 */

export * from './constants';
export * from './icons';
export { Avatar } from './Avatar';
export type { AvatarSize } from './Avatar';
export { Chip } from './Chip';
export type { ChipVariant } from './Chip';
export { PointsTag } from './PointsTag';
export { Sheet } from './Sheet';
export { Stepper } from './Stepper';
export { SavedPill } from './SavedPill';
export type { SaveState } from './SavedPill';
export { AdvancerPicker } from './AdvancerPicker';
export { EmptyState } from './EmptyState';
export { ScreenHeader } from './ScreenHeader';
export { DayLabel } from './DayLabel';
export { PendingBadge } from './PendingBadge';
export { PendingStrip } from './PendingStrip';
export { FilterChips } from './FilterChips';
export type { FilterOption } from './FilterChips';
export { MatchCard } from './MatchCard';
export { PicksTable } from './PicksTable';
export { HistoryList } from './HistoryList';
export { StatTiles } from './StatTiles';
