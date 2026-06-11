/* Quiniela — scoring engine + match status + standings + date formatting. */
(function () {
  const MS_MIN = 60000;

  /* ---------- match status ---------- */
  // 'void' | 'final' | 'postponed' | 'live' | 'awaiting' | 'upcoming'
  function statusOf(m, now, results, voided) {
    if (voided[m.id] || m.voided) return "void";
    const r = results[m.id] || m.result;
    if (r) return "final";
    if (m.postponed && now < m.ko) return "postponed";
    if (now >= m.ko) {
      const mins = (now - m.ko) / MS_MIN;
      return mins > 115 ? "awaiting" : "live";
    }
    return "upcoming";
  }
  const liveMinute = (m, now) => Math.min(90, Math.max(1, Math.round((now - m.ko) / MS_MIN - 1)));
  const resultOf = (m, results) => results[m.id] || m.result || null;
  const isKO = (m) => m.stage === "KO";
  const isLocked = (st) => st === "live" || st === "awaiting" || st === "final";

  /* ---------- picks ---------- */
  function pickComplete(pick, m) {
    if (!pick || pick.h == null || pick.a == null) return false;
    if (isKO(m) && pick.h === pick.a && !pick.adv) return false;
    return true;
  }

  /* result.adv: advancing team code for KO draws; else winner by score */
  function advancerOf(m, r) {
    if (!isKO(m) || !r) return null;
    if (r.h > r.a) return m.home;
    if (r.a > r.h) return m.away;
    return r.adv || null;
  }

  /* ---------- scoring (the table in the brief) ----------
     returns { pts, tag } — tag: 'exact' | 'outcome' | 'draw' | 'miss' | 'none' */
  function scorePick(pick, m, r) {
    if (!pickComplete(pick, m)) return { pts: 0, tag: "none" };
    if (!r) return null;
    if (!isKO(m)) {
      if (pick.h === r.h && pick.a === r.a) return { pts: 3, tag: "exact" };
      const sg = Math.sign(pick.h - pick.a), so = Math.sign(r.h - r.a);
      return sg === so ? { pts: 1, tag: "outcome" } : { pts: 0, tag: "miss" };
    }
    const realAdv = advancerOf(m, r);
    const pickAdv = pick.h > pick.a ? m.home : pick.a > pick.h ? m.away : pick.adv;
    if (pick.h === r.h && pick.a === r.a && pickAdv === realAdv) return { pts: 3, tag: "exact" };
    if (r.h === r.a && pick.h === pick.a) return { pts: 1, tag: "draw" };
    if (pickAdv === realAdv) return { pts: 1, tag: "outcome" };
    return { pts: 0, tag: "miss" };
  }

  /* admin confirm-dialog impact: counts per tag for a hypothetical result */
  function impactOf(m, r, allPicks, members) {
    const c = { exact: 0, outcome: 0, draw: 0, miss: 0, none: 0 };
    members.forEach((mb) => {
      const s = scorePick((allPicks[m.id] || {})[mb.id], m, r);
      c[(s || { tag: "none" }).tag]++;
    });
    return c;
  }

  /* ---------- standings ---------- */
  // scoredIds: matches to count. Returns sorted rows with shared ranks.
  function standings(members, matches, allPicks, results, voided, onlyIds) {
    const rows = members.map((mb) => {
      let pts = 0, exact = 0;
      matches.forEach((m) => {
        if (onlyIds && !onlyIds.includes(m.id)) return;
        if (statusOf(m, window.Q_NOW, results, voided) !== "final") return;
        const s = scorePick((allPicks[m.id] || {})[mb.id], m, resultOf(m, results));
        if (s) { pts += s.pts; if (s.tag === "exact") exact++; }
      });
      return { id: mb.id, pts, exact };
    });
    rows.sort((a, b) => b.pts - a.pts || b.exact - a.exact);
    let rank = 0, prev = null;
    rows.forEach((r, i) => {
      const key = r.pts + ":" + r.exact;
      if (key !== prev) { rank = i + 1; prev = key; }
      r.rank = rank;
    });
    rows.forEach((r) => { r.tied = rows.filter((x) => x.rank === r.rank).length > 1; });
    return rows;
  }

  /* movement vs previous matchday: ▲ ▼ – */
  function withMovement(members, matches, allPicks, results, voided) {
    const now = standings(members, matches, allPicks, results, voided);
    const finals = matches
      .filter((m) => statusOf(m, window.Q_NOW, results, voided) === "final")
      .sort((a, b) => a.ko - b.ko);
    if (finals.length > 1) {
      const prevIds = finals.slice(0, -1).map((m) => m.id);
      const prev = standings(members, matches, allPicks, results, voided, prevIds);
      const prevRank = {}; prev.forEach((r) => { prevRank[r.id] = r.rank; });
      now.forEach((r) => { r.move = Math.sign((prevRank[r.id] || r.rank) - r.rank); });
    } else now.forEach((r) => { r.move = 0; });
    return now;
  }

  /* pending picks for one member (upcoming or postponed, incomplete pick) */
  function pendingMatches(memberId, matches, allPicks, results, voided, myOverrides) {
    return matches.filter((m) => {
      const st = statusOf(m, window.Q_NOW, results, voided);
      if (st !== "upcoming" && st !== "postponed") return false;
      const pick = (myOverrides && myOverrides[m.id]) || (allPicks[m.id] || {})[memberId];
      return !pickComplete(pick, m);
    });
  }

  /* ---------- formatting ---------- */
  function fmtTime(d, lang) {
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US",
      { hour: "numeric", minute: "2-digit", hour12: lang !== "es" }).format(d);
  }
  function fmtDay(d, lang, t) {
    const now = window.Q_NOW;
    const sameDay = (a, b) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    if (sameDay(d, now)) return t("today");
    const tom = new Date(now); tom.setDate(now.getDate() + 1);
    if (sameDay(d, tom)) return t("tomorrow");
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US",
      { weekday: "short", day: "numeric", month: "short" }).format(d);
  }
  function fmtCountdown(toDate, lang) {
    const mins = Math.max(1, Math.round((toDate - window.Q_NOW) / MS_MIN));
    const h = Math.floor(mins / 60), mm = mins % 60;
    if (h >= 24) { const dd = Math.floor(h / 24); return lang === "es" ? dd + " d" : dd + "d"; }
    if (h > 0) return lang === "es" ? h + " h " + mm + " min" : h + "h " + mm + "m";
    return lang === "es" ? mm + " min" : mm + "m";
  }
  const teamName = (code, lang) => window.Q_TEAMS[code][lang === "es" ? "es" : "en"];
  function stageLabel(m, t) { return m.stage === "KO" ? t("r32") : t("group", { g: m.stage }); }

  window.QEngine = {
    statusOf, liveMinute, resultOf, isKO, isLocked, pickComplete, advancerOf,
    scorePick, impactOf, standings: withMovement, pendingMatches,
    fmtTime, fmtDay, fmtCountdown, teamName, stageLabel,
  };
})();
