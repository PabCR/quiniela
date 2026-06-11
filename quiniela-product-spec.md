# Quiniela — Product Spec

**Product:** Family World Cup prediction pool (quiniela) PWA
**Owner:** Pablo
**Audience:** Designer, engineering
**Status:** Final — describes the complete desired state of the app

---

## 1. Problem Statement

Family quinielas today run on WhatsApp messages and a spreadsheet someone maintains by hand: picks get lost, late picks cause arguments, and the scoreboard is updated whenever the admin has time. This app makes the pool self-running — picks lock automatically at kickoff, results flow in from a sports API, points compute instantly, and the leaderboard is always current — so the family argues about football, not bookkeeping.

## 2. Goals

1. Every participant can submit a pick for any match in under 30 seconds from their phone.
2. Zero manual scorekeeping: results and points compute automatically; the admin only intervenes to correct.
3. Zero disputed picks: locking and reveal are enforced by the system, not trust.
4. ≥80% of participants submit picks for ≥90% of matches (reminders working).
5. Onboarding friction near zero: a relative clicks one link and is participating within 1 minute, in their language.

## 3. Non-Goals

- **Money handling.** Buy-in and payouts stay outside the app. (Legal/complexity; family handles cash.)
- **Multiple simultaneous pools / public signup.** One family pool. Data model is multi-pool ready (see §9) but no pool-creation UI.
- **Other tournaments.** World Cup only. Fixture model should not hardcode WC specifics, but no league support.
- **Bracket prediction.** No "predict the champion / group winners" side bets.
- **Social features.** No in-app chat or comments — the family group chat already exists.

## 4. Users & Roles

| Role | Who | Needs |
|---|---|---|
| **Participant** | ~16 family members, ages ~15–70, mixed tech comfort, ES/EN mixed | Pick fast, see standings, get reminded |
| **Admin** | Pablo (pool creator) | Configure rules, invite people, correct results, resolve problems |

Admin is also a participant. One pool; admin role is per-pool.

## 5. User Stories & Acceptance Criteria

### Onboarding (Participant)

**US-1** — As a family member, I want to join by tapping a shared link and picking my name, so that I don't need passwords or accounts.

- Admin pre-creates the member list (names); invite link is shared in family chat.
- Tapping link → language auto-detected (override toggle visible) → "Who are you?" list of unclaimed names → tap name → optional avatar/emoji → in.
- A claimed name disappears from the list. Device session persists (long-lived token); re-auth = re-tap link and re-pick (admin can release a claimed name if someone loses their device or claims wrong).
- PWA install prompt ("Add to home screen") shown after first pick is saved, not before. Notification permission requested at the same moment, with copy explaining why.

### Predicting (Participant)

**US-2** — As a participant, I want to see upcoming matches with my pick status, so I instantly know what's pending.

- Default screen: match list grouped by date, "Today" first. Each match card: flags, team names, kickoff in local device time, my pick (or "No pick yet" state), lock countdown when <2h to kickoff.
- Clear visual distinction: picked / not picked / locked / finished.
- Header badge: "X picks pending."

**US-3** — As a participant, I want to enter and edit a score prediction until kickoff, so I can react to lineups and news.

- Tap match → score stepper or numpad per team (0–9 sufficient, allow up to 15). Save is one tap; autosave acceptable.
- Editable any number of times until lock. Lock = official kickoff timestamp; server-enforced (client countdown is cosmetic).
- After lock, my pick is read-only and visibly marked locked.
- Knockout matches: I predict the **final result including extra time** (120-min score). If I predict a draw, I must also pick who advances on penalties. See scoring §6.

**US-4** — As a participant, I want to see everyone's picks for a match once it locks, so the rivalry is fun and transparent.

- Before lock: I see only my own pick; others show as "hidden" (show *who has picked*, not *what* — drives FOMO and reminders).
- At lock: match detail shows all picks. During live/finished states, each pick shows earned points.

### Scoreboard (Participant)

**US-5** — As a participant, I want a live leaderboard, so I always know where I stand.

- Sized for ~16 people: rank, name, total points, exact-score count, picks made. Rank movement indicator vs. previous matchday (▲▼).
- Ties broken by most exact scores; if still tied, share the position (display "T-2"). Current user's row pinned if scrolled out of view.
- Tapping a person opens their profile: per-match pick history (locked matches only) and stats.

**US-6** — As a participant, I want to see how points were calculated for a match, so results are never disputed.

- Match detail (finished): final score, each person's pick, points earned, and rule applied (see §6 UI tags).
- Missed pick = 0 points, displayed as "—" (no pick), distinct from a wrong pick.

### Notifications (Participant)

**US-7** — As a participant, I want a reminder before kickoff if I haven't picked, so I never lose points by forgetting.

- Push (PWA) with email fallback if push not granted. Sent only to users **missing picks**: default 24h and 1h before each match's kickoff (configurable per user: off / 1h only / 24h+1h).
- Deep-links directly to the pick screen for that match.

**US-8** — As a participant, I want to be notified when a match finishes, with my points and new rank.

- "Final: MEX 2–1 KOR. Exact score! +3 pts. You're now 2nd." Sent shortly after result confirmation.
- Batched if multiple matches end together (one notification per result wave, not per match).

### Admin

**US-9** — As the admin, I want to configure scoring when setting up the pool, so it matches our house rules.

- Configurable at pool creation, editable only until first match locks: points for full hit (default 3) and partial hit (default 1) — same two values apply to group stage and knockouts (see §6).
- After first lock, scoring is frozen (banner explains why).

**US-10** — As the admin, I want results to flow in automatically but be correctable, so I'm not data entry but I'm still in control.

- Fixtures + results sync from a sports API. Result enters "provisional" state on match end; auto-confirms after 2h unless admin overrides.
- Admin override screen: edit final score / advancing team per match. Override triggers full recompute of that match's points and the leaderboard, with an audit note visible on the match ("corrected by admin").
- Confirm dialog on save shows the points impact ("This awards: 3 exact, 5 outcome, 8 miss").
- If the API is down, admin can enter any result manually (same screen).

**US-11** — As the admin, I want to manage members, so I can fix human problems.

- Add/remove names, release a claimed name, regenerate the invite link.
- Removing a member after they've scored points: soft-hide from leaderboard, data retained.

## 6. Scoring Rules (canonical)

Point values set by the admin at pool creation (defaults below), frozen at first lock.

### Group stage

| Outcome | Points (default) |
|---|---|
| Exact score | **3** |
| Correct outcome only (win/draw/loss), wrong score | **1** |
| Wrong outcome | **0** |
| No pick before lock | **0** |

### Knockout matches

Scored on the **post-ET score** (120-min score if ET played, 90-min otherwise) and the **advancing team**. Every KO prediction implies an advancing team: a non-draw prediction's winner is the advancing pick; a draw prediction requires an explicit "who advances" pick (US-3).

| KO outcome | Points (default) |
|---|---|
| Exact post-ET score **and** correct advancing team | **3** |
| Correct advancing team (wrong or no exact score) | **1** |
| Predicted a draw **and** match was a draw after ET — any score, even with wrong penalties pick | **1** |
| Anything else | **0** |

Points never stack — max one rule applies per match. Note the deliberate consequence: calling any draw guarantees at least 1 point regardless of the penalties pick, making draw predictions slightly "safer" than win predictions. Confirmed house rule.

UI tags: `Exact` · `Outcome` · `Draw called` · `—` (no pick).

**Leaderboard ties:** total points → most exact scores → shared rank.

**Edge cases:**
- Postponed/rescheduled match: lock moves to new kickoff; existing picks survive; participants notified.
- Abandoned/voided match: admin marks void → 0 points for all, excluded from "picks made" counts.
- Kickoff time changes from the API: lock follows the updated time; existing picks remain valid.

## 7. Screens (design inventory)

1. **Join / claim name** — language toggle, name list, avatar pick.
2. **Matches (home)** — date-grouped list, pick states, today emphasized, pending-picks badge. Filter: All / My pending.
3. **Match detail / pick** — pre-lock: my pick editor + who-has-picked indicators. Post-lock: all picks. Finished: picks + points breakdown.
4. **Leaderboard** — ranks, tiebreak indicator, movement arrows, pinned self-row.
5. **Member profile** — pick history, stats (exact scores, outcome hits, miss count, points per matchday sparkline).
6. **My settings** — language, notification preferences, avatar.
7. **Admin: pool setup** — scoring config, member list, invite link.
8. **Admin: results** — provisional results queue, override/manual entry, void match.

States the designer must cover per match card: *upcoming-unpicked, upcoming-picked, locked/live, provisional result, final, void, postponed, urgent-unpicked (<2h).*

See companion `quiniela-design-brief.md` for full design direction.

## 8. Requirements Summary

- Invite-link + name-claim auth with persistent sessions
- ES/EN full UI (single toggle, persisted per user)
- Fixture and result sync from a sports API, with admin override and manual fallback
- Pick entry + server-side lock at kickoff; pick reveal at lock
- Points auto-compute on result confirmation; admin-configurable scoring per §6, frozen at first lock
- Leaderboard with tiebreak logic and member profiles
- Push reminders (unpicked, 24h/1h) and result notifications, email fallback
- Admin tools: pool setup, results queue/override, member management
- PWA: installable (manifest + home-screen install), offline shell showing cached matches and leaderboard (picks require connectivity)
- Per-matchday leaderboard view ("who won today")
- Stats: streaks, best matchday, head-to-head vs. one family member
- Group-stage standings context next to fixtures (so people can see what's at stake)
- "Copy my picks summary" share-to-WhatsApp text for trash talk

### Future considerations (explicitly out of the current product)
- Multi-pool: pool creation, join codes, per-pool roles (data model ready, §9)
- Champion/bracket side predictions with bonus points
- Other tournaments
- Payout tracker (record buy-in/payout, still no money movement)

## 9. Data Model Notes (multi-pool ready)

Everything pool-scoped from day one: `Pool` (scoring config, invite token) → `Membership` (user↔pool, role, display name) → `Prediction` (membership, match, home, away, penalties-advance pick, updated_at). `Tournament` → `Match` (kickoff, stage, status, 90/ET scores, advancing team) is shared across pools. Points are computed and stored per prediction (denormalized) for fast leaderboards and clean recompute on admin override. The app instantiates a single pool row.

**Tech direction (decided):** static frontend (vanilla single-page PWA) + Supabase for DB, auth tokens, and server-enforced locks.

## 10. Success Metrics

**Leading:** % of matches with pick submitted per active user (target ≥90%); reminder→pick conversion (target ≥50%); time-to-join from link tap (target <60s, p75).
**Lagging:** weekly active participants ÷ pool size through the final (target ≥85%); zero admin-disputed scoring incidents; family uses it again for the next tournament.

## 11. Risks

- **iOS PWA push** requires the app to be installed to home screen; email fallback is the safety net for relatives who skip install. Install-prompt UX is load-bearing. **Owner: engineering/design.**
- **Sports API selection** (e.g., football-data.org, API-Football): free-tier rate limits vs. result latency; must support the 48-team / 104-match format and provide ET/penalty detail for knockout scoring. **Owner: engineering.**

## 12. Open Questions

1. **Design:** Reveal moment — is a "picks revealed" state at lock worth a celebratory treatment, or keep it quiet?
2. **Engineering:** Result confirmation source of truth — auto-confirm provisional results after 2h, or require admin confirm for knockout matches given ET/penalty data quality?