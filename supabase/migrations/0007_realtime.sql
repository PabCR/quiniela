-- 0007_realtime.sql
-- Add games and guesses to the supabase_realtime publication so results and
-- reveals stream to clients without a refresh (brief §9). RLS still applies to
-- realtime reads, so members only receive rows they are permitted to see.

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.guesses;
