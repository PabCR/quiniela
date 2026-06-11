# Handoff: Quiniela — Family World Cup Prediction Pool (MVP)

## Overview

Quiniela is a **mobile-first PWA** where ~16 family members predict World Cup match
scores. Each user picks a score per match before kickoff; picks lock automatically at
kickoff and become visible to everyone; an admin enters final results; points compute
automatically; a season-long leaderboard ranks the family.

This package documents the **MVP**: manual results entry, no push notifications, fixed
scoring. Auth is invite-link + tap-your-name (no passwords). Full bilingual UI (Spanish +
English). Light mode only for v1, but tokens are structured so dark mode and themed skins
are a token swap.

**Target stack (per product owner):** static frontend (vanilla HTML/CSS/JS, single page)
+ Supabase. No build step assumed. The prototype is React (for prototyping speed only) —
see "How to read the prototype" below.

---

## About the Design Files

The files in `prototype/` are **design references created in HTML/React** — a working
prototype showing the intended look, copy, states, and behavior. They are **not production
code to ship directly.**

Your task is to **recreate these designs in the target environment** (vanilla HTML/CSS/JS
+ Supabase, per the product owner's constraint — or, if you and the owner decide on a
framework like Svelte/Preact, that's fine too). Reuse the **design tokens verbatim** —
`prototype/tokens.css` is production-ready and should be carried over as-is. The scoring
logic in `prototype/app/engine.js` is also essentially production logic (plain functions,
no React) and can be ported almost directly.

### How to read the prototype
- The prototype uses React + in-browser Babel **only** to move fast. Component structure
  maps cleanly to any framework.
- `tokens.css` — **ship this as-is.** All colors/type/spacing/radii as CSS custom
  properties. No component hardcodes a color.
- `app/engine.js` — **pure functions**, framework-agnostic. Scoring, standings, match
  status, date formatting. Port directly; unit-test against the rules table below.
- `app/i18n.js` — the full ES/EN string dictionary + a tiny `makeT(lang)` translator.
  Ship the dictionary as-is.
- `app/data.js` — **mock data only.** In production this comes from Supabase. Use it to
  understand the data shapes (see "Data Model").
- `app/components.jsx`, `app/screens-*.jsx`, `app/main.jsx` — UI. Recreate using the
  target framework's patterns.
- `ios-frame.jsx`, `tweaks-panel.jsx`, `design-canvas.jsx` — **prototype scaffolding only.
  Do NOT port.** The iOS bezel, the Tweaks dev panel, and the design canvas are
  presentation tools, not part of the app.

---

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, interactions, and copy are
all production-intended. Recreate the UI faithfully using `tokens.css`. The one liberty
taken: the prototype simulates a fixed "now" (Sat 13 Jun 2026, 16:36) so all match states
are visible at once — in production, status derives from the real clock vs. each match's
kickoff.

---

## Screens / Views

The app is a **3-tab structure + admin area**:
1. **Matches** (default) — date-grouped fixture list
2. **Leaderboard**
3. **Me** — picks history, language, stats; admin links live here
- **Admin** (admin role only): Results entry, Members — reached from the Me tab.
- **Join** — first-visit invite flow, shown before the tabbed app when no user is claimed.

Viewport: designed at **402 × 874** (iPhone 16-class). Must not break at desktop widths
(center the column, cap width ~440px). One-handed use matters; all touch targets ≥44px.

---

### 1. Join (first visit via invite link)

**Purpose:** Claim your identity in the pool. No passwords.

**Flow:** Language auto-detects from `navigator.language` (ES if it starts with "es", else
EN), with a visible ES/EN segmented toggle top-right (persisted).
1. **"Who are you? / ¿Quién eres?"** — a 2-column grid of **unclaimed** member names
   (claimed names are hidden). Each is a white rounded card (`--radius-lg`,
   `--shadow-card`), min-height 56px, with an initials avatar + name.
2. Tap a name → **"Pick your avatar"** — a 5-column emoji grid (15 options shown).
   Selected emoji gets an accent border + soft fill. Primary CTA "Let's go / Vamos" +
   a quiet "Skip / Omitir" (avatar is optional).
3. On confirm → land on Matches; the chosen name is now claimed, persisted to
   `localStorage` (in production: a Supabase row claim).

**Edge states (all designed):**
- **All names claimed** — 🙈 empty state, heading "All names are claimed", body "Ask Pablo
  to add you to the pool."
- **Invalid/expired link** — 🔗 empty state, "This link has expired", "Ask Pablo for a new
  invite link."

---

### 2. Matches (home)

**Purpose:** See every fixture, your pick status at a glance, and act on pending picks.
This is the most-used screen.

**Header (`.hd`):**
- Title "Matches / Partidos" (`--text-title`, 22/700).
- **Pending-picks badge** (top-right) — the MVP's substitute for push reminders. Accent
  pill with a dot: "{n} picks pending / {n} pronósticos pendientes". When zero, it flips
  to a **green soft** pill "All picked ✓ / Todo listo ✓". Tapping it filters to pending.
- **Filter chips:** All · My pending (accent fill when active).

**Body:** Matches **grouped by date**, with **Today pinned first**, then upcoming days
ascending, then past days descending. Each group has an uppercase day label
("TODAY · JUN 13").

#### Match card — the core component (7 states)

Base card: white, `--radius-xl` (28px), `--shadow-card`, full-width tappable button.
Layout is a 3-column grid: `[64px team] [1fr center] [64px team]`. Each team = a 46px
circular flag chip (emoji flag on white, own shadow) above a 3-letter FIFA code
(`--text-label`, letter-spacing `--tracking-caps`). The **center** changes per state. Below
the row, a centered meta line (stage label · day/time · etc., dot-separated). Scores use
`font-variant-numeric: tabular-nums` everywhere.

**Never encode state by color alone** — every state pairs color with an icon or label
(lock glyph, check, em-dash, "Live", "Final", "Void").

The **7 states**:

1. **Upcoming, no pick** (most important state). Center shows a ghost "– : –". A distinct
   **lower container ("pending strip", `.mc-strip`)** is appended below the card body:
   neutral surface-2 background, left text "Closes in {countdown}", right a small accent
   pill button "Make your pick". This strip is what visually separates *done* from
   *pending* cards.
2. **Upcoming, picked.** Center: overline "Your pick" + large score (e.g. "1 – 2",
   `--text-score` 30px). Meta includes an underlined "Edit". **No pending strip** — the
   card is visually "settled."
3. **Locked / live.** Card gets a red-tint wash (`--color-live-soft`). Center: a white
   "Live · 64′" chip (red dot + text) above your frozen score prefixed with a **lock
   glyph**, in muted `--color-locked`. Meta: "Your pick is locked." If you never picked,
   center shows an em-dash and meta shows "—".
4. **Final.** Card wash depends on your result: green soft (`--color-exact-soft`) if exact,
   amber soft (`--color-partial-soft`) if outcome/draw-called, no wash if miss. Center:
   overline "Final" + the actual result score + a **points tag** chip (e.g. "Exact · +3").
   Meta: "You picked 2–1" (or "—" if no pick). If the admin corrected the result, a small
   "corrected" note appears.
5. **Void.** Muted card (`--color-void-soft`, no shadow, hairline border), grayscaled
   flags. Center: em-dash + a "Void · Not scored" chip. (Pre-launch matches are voided.)
6. **Postponed.** Center: overline "Postponed" + an amber "New date · Sun, Jun 14" chip.
   Meta notes "Pick stays open." Pending strip still shows if unpicked.
7. **<2h to kickoff, no pick** (urgency variant of state 1). Same as state 1 but the
   pending strip uses the **urgent red** treatment (`.mc-strip--urgent`:
   `--color-urgent-soft` bg, red text, red button) and the text is the live countdown
   "Closes in 1h 24m".

There's also an implicit **awaiting** status (kickoff passed, >115 min elapsed, no result
yet) — renders like locked but with overline "Awaiting result" instead of the live chip.
This is the queue the admin scores from.

**Tab bar (`.tabbar`):** 3 tabs (Matches / Leaderboard / Me) with line icons + labels,
frosted white, top hairline. The Matches tab shows a small **red dot** when picks are
pending. Active tab = full-ink color, inactive = `--color-text-3`.

---

### 3. Match detail / Pick entry

**Purpose:** Make/edit a pick (pre-lock) or review everyone's picks (post-lock).

**Header:** circular back button (44px, white, shadow) + centered stage/day/time line.

**Team display:** 3-column grid — 64px circular flag + balanced team full name on each
side, with the center showing either "vs" (pre-kickoff), your locked score, or the final
result (`--text-display`, 40px).

**Pre-lock (editable) — states:**
- **Score steppers** (`.steps`): two side-by-side cards, each with the team code overline,
  a huge value (44px, tabular), and a `−` / `+` button row. Buttons are 52×48,
  `--radius-md`, range **0–15**. Value starts as "–" (null) until first interaction.
  **The `+`/`−` press triggers a spring "bounce" animation** on the value
  (`@keyframes qBounce`, `--ease-spring`).
- **Autosave + the one delight moment:** any change sets state to "Saving…" then, after
  ~550ms, to a **"Saved ✓"** confirmation (`.saved.pop` — the check badge + label spring
  in via `qBounce`). This is the single sanctioned moment of delight. No manual save button.
- **Knockout draw case (advancer picker):** when the predicted score is a **draw on a KO
  match**, an inline `.adv` panel appears: "Who advances on penalties?" with a 2-button
  picker (the two teams). Until one is chosen, a red warning "Pick who advances to complete
  your prediction" shows and the pick does **not** count as complete (doesn't clear the
  pending badge). Selecting clears the warning and marks complete. Changing the score away
  from a draw removes the requirement (the `adv` field is cleared).
- **Social row (FOMO):** a row of overlapping avatars of members **who have picked** (not
  what they picked) + "9/16 have picked / 9/16 ya pronosticaron". Below it, fine print
  "Picks are revealed at kickoff."

**Post-lock (locked / awaiting / final) — everyone's picks table (`.ptbl`):**
- Header "Everyone's picks". One row per claimed member: avatar, name (your row gets a
  "You" chip + accent-soft highlight `.prow--me`), their score (or em-dash if no pick,
  styled distinctly as `--color-text-disabled`, **never** as "0"), and a points column.
- While locked but **before** a result: the points column shows a **lock glyph**.
- After the **result**: the column shows each member's **points tag** and the table is
  **sorted by points** descending. A no-pick row shows the em-dash tag "—", visually
  distinct from a wrong pick's "0".
- **Void:** shows the picks table without the points column.

---

### 4. Leaderboard

**Purpose:** Season-long ranking. Sized for ~16 rows in one comfortable scroll.

**Row (`.lb-row`):** rank · avatar + name · (exact-count chip) · movement arrow · total
points (22px bold, tabular). **Top 3 are emphasized** (`.lb-row--top`: more padding, the
rank shown as a filled accent circle, larger avatar) — these are the payout positions.

- **Rank** uses shared ranks for ties, displayed "T-2".
- **Exact count** is the tiebreaker — given its own right-aligned column ("2 exact").
- **Movement vs. last matchday:** ▲ green / ▼ red / – gray.
- **Current user's row is pinned** — `.lb-row--me` is `position: sticky; bottom: 6px` with
  an accent outline + float shadow, so you always see your standing even when scrolled out.
- Tap any row → **member profile** (their locked-match pick history + stats: points, exact
  count, position).

**Empty state (pre-first-result):** ⚽ "Everyone starts at zero / Todos empiezan en cero" +
"Points appear after the first final result. Get your picks in!" Friendly, not barren.

**Tiebreak order (drives sort):** points → exact count → shared rank.

---

### 5. Me

**Purpose:** Your hub. Avatar (tap to change — opens the emoji grid inline), name, your
three stat tiles (Points / Exact scores / Position), an ES/EN language segmented control
(persisted), your full pick history (locked matches only, with points tags), and — for the
admin role only — an Admin section linking to Results entry and Members.

---

### 6. Admin: Results entry

**Purpose:** One trusted user enters final scores; one save recomputes everything. Function
over beauty, but error-proofed.

- Two sections: **Awaiting result** (matches finished by the clock but unscored, oldest
  first) and **Entered** (already scored, newest first, each with an "Edit" affordance and
  a "corrected" note if previously edited).
- Tapping a match opens the **entry screen**: the same steppers as pick entry (0–15), plus
  the advancer picker if it's a KO draw.
- **Save → confirm dialog (`.sheet`)** — a bottom sheet showing the exact **points impact**
  before committing: "This awards: 3 exact · 5 outcome · [8 draw called for KO] · 8 miss ·
  1 no pick" as colored chips. Cancel / Confirm. This is the error-proofing.
- **Edit a previous result:** same flow; on confirm it stamps a "corrected" flag (surfaces
  as a note on the match detail and in the admin list).
- **Mark match void:** a destructive secondary action (red outline) → its own confirm
  sheet. Voiding awards no points for that match.

---

### 7. Admin: Members

**Purpose:** Manage the roster and the invite link.

- **Invite link** row: shows `quiniela.app/j/{token}`, with Copy (→ "Copied ✓") and
  Regenerate (rotates the token).
- **Add name** input (Enter or `+` to add).
- **Member list:** avatar, name, claimed/unclaimed sub-label, and a **Release** action on
  claimed names → confirm sheet ("{name} will be able to be claimed again…"). Releasing
  frees the name to be re-claimed from the invite link.

---

## Interactions & Behavior

- **Navigation:** tab bar swaps Matches/Leaderboard/Me. Match card → detail. Leaderboard
  row → profile. Me → admin sub-screens. Back buttons return up one level. No browser
  routing in the prototype; in production, wire to your router (deep links optional for MVP).
- **Autosave:** pick changes debounce ~550ms → "Saving…" → "Saved ✓" (spring). No save
  button.
- **Lock at kickoff:** a pick is editable only while status is `upcoming` or `postponed`.
  At kickoff it freezes and becomes visible to everyone. In production, derive status
  server-side / from synced time; never trust client clock for the lock.
- **Add-to-home-screen hint:** a toast appears **after the first pick is saved** (not
  before) — "Pick saved — nice! Add Quiniela to your home screen…". Shown once
  (`localStorage` flag).
- **Animations:** `qBounce` spring (`cubic-bezier(0.34,1.56,0.64,1)`) on stepper values and
  the saved check; `qSlideUp` for sheets/toasts. Motion is otherwise minimal. Respect
  `prefers-reduced-motion`.
- **i18n:** every string from the dictionary; Spanish is the width worst-case (~30% longer)
  — layouts must not truncate ES. Dates/times localized (`Intl.DateTimeFormat`, es-MX /
  en-US), **always device-local time**. FIFA 3-letter codes next to flags; full names on
  detail.

---

## State Management

State needed (prototype keeps these in React state + `localStorage`; production = Supabase
+ realtime):

- **currentUser** — claimed member id + avatar emoji. (`localStorage: quiniela_user`)
- **lang** — "es" | "en". (`localStorage: quiniela_lang`)
- **myPicks** — `{ [matchId]: { h, a, adv? } }`. (`localStorage: quiniela_my_picks`)
- **results** — admin-entered `{ [matchId]: { h, a, adv? } }`. (`localStorage: quiniela_results`)
- **voided** — `{ [matchId]: true }`. (`localStorage: quiniela_voided`)
- **corrected** — `{ [matchId]: true }`. (`localStorage: quiniela_corrected`)
- **a2hs shown** — once flag. (`localStorage: quiniela_a2hs`)
- Derived (never stored): each match's **status**, per-pick **score/tag**, **standings**,
  **pending list** — all computed by `engine.js` from the above + current time.

**Data fetching (production):** members, matches, picks, results from Supabase. Picks are
write-your-own pre-lock; all picks become readable post-lock (enforce with row-level
security keyed on kickoff time). Admin writes results; a recompute (client or a Supabase
function) updates standings. Realtime subscriptions are nice-to-have, not MVP-required.

---

## Scoring Rules (port exactly — see `engine.js` → `scorePick`)

| Result | Points | Tag |
|---|---|---|
| Exact score (group) / exact post-ET score **and** right advancer (KO) | **3** | `Exact` |
| Correct outcome (group) / correct advancing team (KO) | **1** | `Outcome` |
| KO only: predicted a draw and match drew after ET (any score, any penalty pick) | **1** | `Draw called` |
| Wrong | **0** | — |
| No pick at lock | **0** | `—` (em dash, **never** "0 wrong") |

- A pick is **complete** only if both scores are set **and** (for a KO draw) an advancer is
  chosen. Incomplete picks count as "no pick" (em-dash) at lock.
- KO advancer: if the predicted score isn't a draw, the advancer is implied by the higher
  score; only an explicit draw needs the picker.
- **Tiebreak:** points → exact count → shared rank ("T-2").

---

## Design Tokens

**Ship `prototype/tokens.css` verbatim.** Summary of the alias layer (what components use):

**Neutrals — cool slate** (OKLCH ramp, `--q-slate-0…900`):
- `--color-bg` slate-25 · `--color-surface` #fff · `--color-surface-2` slate-50 ·
  `--color-surface-3` slate-100 · `--color-border` slate-200 · `--color-border-strong`
  slate-300.
- Text: `--color-text` slate-900 · `--color-text-2` slate-600 · `--color-text-3` slate-500
  · `--color-text-disabled` slate-400.

**Accent (interactive):** `--color-accent` = slate-900 ink (`#252b36`-ish), `--color-on-accent`
#fff, `--color-accent-soft` slate-100. **Swappable** — a festive WC skin or team colors
change only this.

**Semantic (pick outcomes & states), matched chroma/lightness, varied hue:**
- `--color-exact` `oklch(0.46 0.11 155)` + `--color-exact-soft` · `--color-partial`
  `oklch(0.50 0.11 75)` + soft · `--color-live` / `--color-urgent` `oklch(0.50 0.16 25)` +
  soft · `--color-locked` slate-600 · `--color-void` slate-400 · `--color-saved` = exact.
- All semantic ink shades verified to pass **WCAG AA** on white and on their soft tints.

**Type — system stack** (`-apple-system, system-ui, …`), **16px body minimum** for older
users: display 40/700, score 28/700, title 22/700, heading 17/650, body 16/400, label
13/600 (uppercase tracking `0.06em`), caption 12/500. All numerics `tabular-nums`.

**Spacing:** 4px grid (4/8/12/16/20/24/32/40). **Radii:** 10 / 16 / 22 / 28 / pill.
**Shadows:** `--shadow-card`, `--shadow-float`. **Tap target:** 44px min.
**Motion:** `--ease-spring` cubic-bezier(0.34,1.56,0.64,1); durations 140/220ms.

**Theming note:** because every component references aliases only, dark mode = redefine the
alias block under a `[data-theme="dark"]` selector (or `prefers-color-scheme`). No component
edits. Same mechanism for a team-color or festive skin.

---

## Assets

- **Flags:** emoji flags (Unicode), used as small identifiers next to team names — no custom
  image assets. If emoji flag rendering is inconsistent on your target platform (notably
  Windows/Chrome lacks flag emoji), substitute a flag-icon webfont/SVG set keyed by ISO
  code — keep them the same small size; flags are identifiers, not decoration.
- **Avatars:** emoji (user-chosen) with an **initials-in-circle fallback** when no emoji is
  set. See `Avatar` in `components.jsx`.
- **Icons:** inline SVG line icons (lock, back chevron, check, tab icons) in
  `components.jsx`. Reuse your codebase's icon set if you have one matching the weights.
- **PWA manifest icon (concept):** simple, neutral, works as monochrome — e.g. a single
  glyph/monogram on the ink accent. Not yet produced; create from the accent token. The
  "Add to home screen" hint is shown **after first pick**, never before.

No raster/photographic assets are used anywhere (deliberately — the design is typographic
and ages across tournaments).

---

## Files (in `prototype/`)

**Ship/port directly:**
- `tokens.css` — design tokens. **Ship as-is.**
- `app/engine.js` — scoring, standings, status, date formatting. **Pure functions; port directly.**
- `app/i18n.js` — ES/EN dictionary + `makeT`. **Ship the dictionary.**

**UI references (recreate in target framework):**
- `app/components.jsx` — Avatar, MatchCard (all 7 states), Stepper, SavedPill, PointsTag, icons.
- `app/screens-matches.jsx` — Matches list + Match detail/pick entry + everyone's-picks table.
- `app/screens-board-me.jsx` — Leaderboard, member profile, Me, history list.
- `app/screens-join-admin.jsx` — Join flow, Admin results entry (+ confirm/void sheets), Admin members.
- `app/main.jsx` — app shell: routing, state wiring, localStorage persistence, a2hs toast.
- `app/app.css` — all component styles (consumes tokens only). Strong reference for exact
  measurements; rewrite in your styling system but keep the values.

**Mock data (shapes only — replace with Supabase):**
- `app/data.js` — teams, real WC 2026 fixtures, 16 members, seeded picks, the simulated `Q_NOW`.

**Prototype scaffolding — DO NOT port:**
- `ios-frame.jsx` (device bezel), `tweaks-panel.jsx` (dev tweak panel), `design-canvas.jsx`,
  `cards.css`, `directions.jsx`, `Match Card Directions.html` (the 3-direction exploration
  that preceded this build — included for context on why Direction A + the pending strip
  was chosen).

**Entry point:** `Quiniela App.html` wires it all together. Open it to interact with the
full prototype. The Tweaks panel (toolbar in the design tool) toggles accent color,
language, Join edge-states, and an empty-leaderboard demo — these are **demo switches**, not
app features.

---

## Data Model (from `data.js` — informs your Supabase schema)

```
team:    { code, flag, en, es }                       // e.g. MEX / 🇲🇽 / Mexico / México
match:   { id, stage, home, away, ko (timestamp),
           result?: {h,a,adv?}, voided?, postponed?, origKo? }
           // stage: group letter "A".."L" or "KO"
member:  { id, name, emoji?, admin?, claimed }
pick:    { h, a, adv? }   keyed by [matchId][memberId]
           // adv = advancing team code, only for KO draws
```

Status is **derived** (not stored): void → final → postponed → live → awaiting → upcoming,
computed from `voided`, presence of `result`, `postponed`+future `ko`, and now-vs-`ko`
elapsed minutes (≤115 = live, >115 = awaiting). See `engine.statusOf`.
