/* Quiniela — Matches list + Match detail / pick entry */
const EM = window.QEngine;

/* ---------- Matches (home) ---------- */
function MatchesScreen({ lang, t, me, getPick, results, voided, corrected, onOpen, pending }) {
  const [filter, setFilter] = React.useState("all");
  const now = window.Q_NOW;
  const dayKey = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  const todayKey = dayKey(now);

  let list = window.Q_MATCHES.slice();
  if (filter === "pending") list = list.filter((m) => pending.some((p) => p.id === m.id));

  const groups = {};
  list.forEach((m) => { const k = dayKey(m.ko); (groups[k] = groups[k] || []).push(m); });
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === todayKey) return -1; if (b === todayKey) return 1;
    const da = groups[a][0].ko, db = groups[b][0].ko;
    const fa = da >= now, fb = db >= now;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? da - db : db - da;
  });
  keys.forEach((k) => groups[k].sort((a, b) => a.ko - b.ko));

  return (
    <React.Fragment>
      <header className="hd">
        <div className="hd-row">
          <h1 className="hd-title">{t("tabMatches")}</h1>
          <button
            className={"hd-badge" + (pending.length === 0 ? " hd-badge--done" : "")}
            onClick={() => setFilter(pending.length ? "pending" : "all")}>
            {pending.length > 0 && <span className="dot"></span>}
            {pending.length === 0 ? t("pendingNone")
              : pending.length === 1 ? t("pending_one") : t("pending_other", { n: pending.length })}
          </button>
        </div>
        <div className="chips">
          <button className={"fchip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>{t("filterAll")}</button>
          <button className={"fchip" + (filter === "pending" ? " on" : "")} onClick={() => setFilter("pending")}>{t("filterPending")}</button>
        </div>
      </header>
      <div className="app-scroll">
        {keys.map((k) => (
          <section key={k}>
            <div className="day-label">
              {EM.fmtDay(groups[k][0].ko, lang, t)}
              {" · "}
              {new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short" }).format(groups[k][0].ko)}
            </div>
            {groups[k].map((m) => (
              <MatchCard key={m.id} m={m} lang={lang} t={t} myPick={getPick(m.id)}
                results={results} voided={voided} corrected={corrected[m.id]} onOpen={() => onOpen(m.id)} />
            ))}
          </section>
        ))}
        {keys.length === 0 && (
          <div className="lb-empty"><span className="big">🎉</span><h2>{t("pendingNone")}</h2></div>
        )}
      </div>
    </React.Fragment>
  );
}

/* ---------- everyone's picks table ---------- */
function PicksTable({ m, t, meId, results, voided, withPoints }) {
  const r = EM.resultOf(m, results);
  const picks = window.Q_PICKS[m.id] || {};
  const isVoid = EM.statusOf(m, window.Q_NOW, results, voided) === "void";
  let rows = window.Q_MEMBERS.filter((mb) => mb.claimed || mb.id === meId).map((mb) => {
    const p = picks[mb.id];
    const s = withPoints && r ? EM.scorePick(p, m, r) : null;
    return { mb, p, s };
  });
  if (withPoints && r) rows.sort((a, b) => (b.s ? b.s.pts : -1) - (a.s ? a.s.pts : -1));
  return (
    <div className="ptbl">
      <div className="ptbl-h">{t("everyonesPicks")}</div>
      {rows.map(({ mb, p, s }) => (
        <div key={mb.id} className={"prow" + (mb.id === meId ? " prow--me" : "")}>
          <Avatar member={mb} />
          <span className="prow-name">{mb.name}{mb.id === meId && <span className="chip chip--void" style={{ marginLeft: 7 }}>{t("youChip")}</span>}</span>
          <span className={"prow-pick" + (p && p.h != null ? "" : " prow-pick--none")}>
            {p && p.h != null ? p.h + "–" + p.a : "—"}
            {p && p.adv && <span style={{ fontSize: 12, marginLeft: 4 }}>{window.Q_TEAMS[p.adv].flag}</span>}
          </span>
          {withPoints && !isVoid && (
            <span className="prow-pts">{r ? <PointsTag tag={s ? s.tag : "none"} pts={s ? s.pts : 0} t={t} /> : <IcLock />}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- match detail / pick entry ---------- */
function DetailScreen({ matchId, lang, t, me, getPick, setPick, results, voided, corrected, onBack, onFirstSave }) {
  const m = window.Q_MATCHES.find((x) => x.id === matchId);
  const st = EM.statusOf(m, window.Q_NOW, results, voided);
  const r = EM.resultOf(m, results);
  const pick = getPick(m.id) || {};
  const [saveState, setSaveState] = React.useState("idle");
  const saveTimer = React.useRef(null);

  const update = (patch) => {
    let next = Object.assign({}, pick, patch);
    if (next.h !== next.a) delete next.adv;
    setPick(m.id, next);
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState("saved");
      if (EM.pickComplete(next, m)) onFirstSave();
    }, 550);
  };

  const editable = st === "upcoming" || st === "postponed";
  const locked = st === "live" || st === "awaiting";
  const needsAdv = EM.isKO(m) && pick.h != null && pick.h === pick.a;
  const pickedMembers = window.Q_MEMBERS.filter((mb) => {
    const p = mb.id === me.id ? pick : (window.Q_PICKS[m.id] || {})[mb.id];
    return EM.pickComplete(p, m) && (mb.claimed || mb.id === me.id);
  });
  const claimedCount = window.Q_MEMBERS.filter((mb) => mb.claimed || mb.id === me.id).length;
  const myScore = r ? EM.scorePick(pick, m, r) : null;

  const Team = ({ code }) => (
    <div className="dt-team">
      <span className="dt-flag">{window.Q_TEAMS[code].flag}</span>
      <span className="dt-name">{EM.teamName(code, lang)}</span>
    </div>
  );

  return (
    <div data-screen-label={"Match detail " + m.home + "-" + m.away}>
      <div className="dt-top">
        <button className="backbtn" onClick={onBack} aria-label={t("back")}><IcBack /></button>
        <span className="dt-stage">
          {EM.stageLabel(m, t)} · {EM.fmtDay(m.ko, lang, t)}, {EM.fmtTime(m.ko, lang)}
        </span>
        <span className="dt-spacer"></span>
      </div>
      <div className="app-scroll">
        <div className="dt-teams">
          <Team code={m.home} />
          {st === "final" ? <span className="dt-center-score">{r.h}–{r.a}</span>
            : locked && pick.h != null ? <span className="dt-center-score" style={{ color: "var(--color-locked)" }}>{pick.h}–{pick.a}</span>
            : <span className="dt-vs">vs</span>}
          <Team code={m.away} />
        </div>

        {st === "void" && (
          <div className="dt-sub"><span className="chip chip--void">{t("voidTag")}</span></div>
        )}
        {st === "postponed" && (
          <div className="dt-sub"><span className="chip chip--postponed">{t("newDate", { d: EM.fmtDay(m.ko, lang, t) + ", " + EM.fmtTime(m.ko, lang) })}</span></div>
        )}
        {st === "live" && (
          <div className="dt-sub"><span className="chip chip--live"><span className="livedot"></span>{t("live")} · {EM.liveMinute(m, window.Q_NOW)}′</span></div>
        )}
        {st === "awaiting" && <div className="dt-sub">{t("awaitingResult")}</div>}
        {st === "final" && (
          <div className="dt-sub" style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
            {myScore && <PointsTag tag={myScore.tag} pts={myScore.pts} t={t} />}
            {corrected[m.id] && <span className="corr">{t("corrected")}</span>}
          </div>
        )}
        {locked && <div className="dt-sub"><IcLock /> {pick.h != null ? t("lockedNote") : t("tagNoPick")}</div>}

        {editable && (
          <React.Fragment>
            <div className="steps">
              <Stepper label={m.home} value={pick.h == null ? null : pick.h} onChange={(v) => update({ h: v, a: pick.a == null ? 0 : pick.a })} />
              <Stepper label={m.away} value={pick.a == null ? null : pick.a} onChange={(v) => update({ a: v, h: pick.h == null ? 0 : pick.h })} />
            </div>
            <div style={{ textAlign: "center", paddingTop: 8 }}>
              <SavedPill state={saveState} t={t} />
            </div>
            {needsAdv && (
              <div className="adv">
                <div className="adv-q">{t("whoAdvances")}</div>
                {!pick.adv && <div className="adv-warn">{t("advNeeded")}</div>}
                <div className="adv-btns">
                  {[m.home, m.away].map((code) => (
                    <button key={code} className={"adv-btn" + (pick.adv === code ? " on" : "")}
                      onClick={() => update({ adv: code })}>
                      <span>{window.Q_TEAMS[code].flag}</span> {code}
                      {pick.adv === code && <IcCheck s={11} c="currentColor" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="social">
              <span className="social-avs">
                {pickedMembers.slice(0, 6).map((mb) => <Avatar key={mb.id} member={mb} />)}
              </span>
              <span className="social-txt">{t("havePicked", { n: pickedMembers.length, m: claimedCount })}</span>
            </div>
            <div className="social-hidden">{t("picksHidden")}</div>
          </React.Fragment>
        )}

        {!editable && st !== "void" && (
          <PicksTable m={m} t={t} meId={me.id} results={results} voided={voided} withPoints={true} />
        )}
        {st === "void" && (
          <PicksTable m={m} t={t} meId={me.id} results={results} voided={voided} withPoints={false} />
        )}
      </div>
    </div>
  );
}

Object.assign(window, { MatchesScreen, DetailScreen, PicksTable });
