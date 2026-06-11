/* Quiniela — shared UI components */
const E = window.QEngine;

/* ---------- tiny icons ---------- */
const IcLock = ({ s = 13 }) => (
  <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ display: "inline-block", verticalAlign: "-1px" }}>
    <rect x="2.2" y="6.2" width="9.6" height="6.3" rx="2" fill="currentColor"></rect>
    <path d="M4.6 6V4.6a2.4 2.4 0 0 1 4.8 0V6" stroke="currentColor" strokeWidth="1.6" fill="none"></path>
  </svg>
);
const IcBack = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 3.5L6 9l5.5 5.5"></path>
  </svg>
);
const IcCheck = ({ s = 10, c = "#fff" }) => (
  <svg width={s} height={s} viewBox="0 0 10 10" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 5.5l2.5 2.5 4.5-5"></path>
  </svg>
);
const IcChev = () => (
  <svg className="chev" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 3l4.5 4L5 11"></path>
  </svg>
);
const TabIcon = ({ kind }) => {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (kind === "matches") return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...p}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="4"></rect>
      <path d="M3.5 9.5h17M8 3v3M16 3v3"></path>
    </svg>
  );
  if (kind === "board") return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...p}>
      <path d="M7 4.5h10v5a5 5 0 0 1-10 0v-5z"></path>
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.4M17 6h2.5a2.5 2.5 0 0 1-2.6 3.4M12 14.5V18M8.5 20.5h7"></path>
    </svg>
  );
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="8.5" r="3.7"></circle>
      <path d="M4.8 20c1.3-3.2 4-5 7.2-5s5.9 1.8 7.2 5"></path>
    </svg>
  );
};

/* ---------- avatar (emoji, initials fallback) ---------- */
const Avatar = ({ member, size }) => {
  const cls = "av" + (size === "lg" ? " av--lg" : size === "xl" ? " av--xl" : "");
  if (member && member.emoji) return <span className={cls}>{member.emoji}</span>;
  const ini = member ? member.name.split(" ").map((w) => w[0]).slice(0, 2).join("") : "?";
  return <span className={cls}><span className="av-initials">{ini}</span></span>;
};

/* ---------- points tag ---------- */
const PointsTag = ({ tag, pts, t, soft }) => {
  if (tag === "none") return <span className="chip chip--void">—</span>;
  if (tag === "exact") return <span className={"chip " + (soft ? "chip--exact-soft" : "chip--exact")}>{t("tagExact")} · +{pts}</span>;
  if (tag === "outcome") return <span className="chip chip--outcome">{t("tagOutcome")} · +{pts}</span>;
  if (tag === "draw") return <span className="chip chip--outcome">{t("tagDraw")} · +{pts}</span>;
  return <span className="chip chip--void">0</span>;
};

/* ---------- match card (Direction A + pending strip) ---------- */
function MatchCard({ m, lang, t, myPick, results, voided, corrected, onOpen }) {
  const st = E.statusOf(m, window.Q_NOW, results, voided);
  const r = E.resultOf(m, results);
  const complete = E.pickComplete(myPick, m);
  const hasNums = myPick && myPick.h != null;
  const score = (p) => p.h + " – " + p.a;
  const Team = ({ code }) => (
    <span className="mc-team">
      <span className="mc-flag">{window.Q_TEAMS[code].flag}</span>
      <span className="mc-code">{code}</span>
    </span>
  );
  const meta = [];
  const stage = E.stageLabel(m, t);
  const dayTime = E.fmtDay(m.ko, lang, t) + ", " + E.fmtTime(m.ko, lang);

  let wash = "", center = null, strip = null;
  const urgent = st === "upcoming" && !complete && (m.ko - window.Q_NOW) < 2 * 3600000;

  if (st === "upcoming" || st === "postponed") {
    if (complete) {
      center = (
        <React.Fragment>
          <span className="mc-overline">{t("yourPick")}</span>
          <span className="mc-score">{score(myPick)}</span>
        </React.Fragment>
      );
      if (st === "postponed") {
        meta.push(<span key="p" className="chip chip--postponed">{t("newDate", { d: E.fmtDay(m.ko, lang, t) + ", " + E.fmtTime(m.ko, lang) })}</span>);
        meta.push(stage);
      } else {
        meta.push(stage, dayTime, <span key="e" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>{t("edit")}</span>);
      }
    } else {
      center = st === "postponed"
        ? (
          <React.Fragment>
            <span className="mc-overline">{t("postponed")}</span>
            <span className="chip chip--postponed">{t("newDate", { d: E.fmtDay(m.ko, lang, t) + ", " + E.fmtTime(m.ko, lang) })}</span>
          </React.Fragment>
        )
        : <span className="mc-score mc-score--ghost">– : –</span>;
      meta.push(stage); if (st !== "postponed") meta.push(dayTime); else meta.push(t("pickOpen"));
      const needsAdv = hasNums && !complete;
      strip = (
        <span className={"mc-strip" + (urgent ? " mc-strip--urgent" : "")}>
          <span>{needsAdv ? t("advNeeded") : t("closesIn", { t: E.fmtCountdown(m.ko, lang) })}</span>
          <span className="mc-strip-btn">{t("makePick")}</span>
        </span>
      );
    }
  } else if (st === "live") {
    wash = "mc--live";
    center = (
      <React.Fragment>
        <span className="chip chip--live"><span className="livedot"></span>{t("live")} · {E.liveMinute(m, window.Q_NOW)}′</span>
        <span className="mc-score" style={{ color: "var(--color-locked)" }}>
          {hasNums ? <React.Fragment><IcLock s={15} /> {score(myPick)}</React.Fragment> : <span className="mc-score--ghost">—</span>}
        </span>
      </React.Fragment>
    );
    meta.push(stage, hasNums ? t("lockedNote") : t("tagNoPick"));
  } else if (st === "awaiting") {
    center = (
      <React.Fragment>
        <span className="mc-overline">{t("awaitingResult")}</span>
        <span className="mc-score" style={{ color: "var(--color-locked)" }}>
          {hasNums ? <React.Fragment><IcLock s={15} /> {score(myPick)}</React.Fragment> : <span className="mc-score--ghost">—</span>}
        </span>
      </React.Fragment>
    );
    meta.push(stage, E.fmtDay(m.ko, lang, t));
  } else if (st === "final") {
    const s = E.scorePick(myPick, m, r);
    wash = s && s.tag === "exact" ? "mc--exact" : s && (s.tag === "outcome" || s.tag === "draw") ? "mc--partial" : "";
    center = (
      <React.Fragment>
        <span className="mc-overline">{t("final")}</span>
        <span className="mc-score">{r.h + " – " + r.a}</span>
        <PointsTag tag={s ? s.tag : "none"} pts={s ? s.pts : 0} t={t} soft={s && s.tag === "exact"} />
      </React.Fragment>
    );
    meta.push(stage, complete ? t("youPicked", { s: score(myPick) }) : t("tagNoPick"));
    if (corrected) meta.push(<span key="c" className="corr">{t("editedTag")}</span>);
  } else {
    wash = "mc--void";
    center = (
      <React.Fragment>
        <span className="mc-score mc-score--ghost">—</span>
        <span className="chip chip--void">{t("voidTag")}</span>
      </React.Fragment>
    );
    meta.push(stage, t("played", { d: E.fmtDay(m.ko, lang, t) }));
  }

  return (
    <button className={"mc " + wash} onClick={onOpen} data-comment-anchor={"card-" + m.id}>
      <span className="mc-body">
        <span className="mc-row">
          <Team code={m.home} />
          <span className="mc-center">{center}</span>
          <Team code={m.away} />
        </span>
        <span className="mc-meta">
          {meta.map((x, i) => <React.Fragment key={i}>{i > 0 && <span style={{ opacity: .5 }}>·</span>}{x}</React.Fragment>)}
        </span>
      </span>
      {strip}
    </button>
  );
}

/* ---------- stepper ---------- */
function Stepper({ value, onChange, label }) {
  const [bounce, setBounce] = React.useState(0);
  const set = (v) => {
    if (v < 0 || v > 15) return;
    onChange(v); setBounce((b) => b + 1);
  };
  return (
    <div className="step">
      <span className="mc-overline">{label}</span>
      <span key={bounce} className={"step-val" + (bounce ? " bounce" : "")}>{value == null ? "–" : value}</span>
      <span className="step-btns">
        <button className="step-btn" disabled={value == null || value <= 0} onClick={() => set((value || 0) - 1)} aria-label="minus">−</button>
        <button className="step-btn" onClick={() => set(value == null ? 0 : value + 1)} aria-label="plus">+</button>
      </span>
    </div>
  );
}

/* ---------- saved confirmation (the delight moment) ---------- */
function SavedPill({ state, t }) {
  // state: 'idle' | 'saving' | 'saved'
  return (
    <div className={"saved" + (state === "saved" ? " pop" : "")} style={{ opacity: state === "idle" ? 0 : 1 }}>
      {state === "saved" && <span className="saved-check"><IcCheck /></span>}
      {state === "saving" ? <span style={{ color: "var(--color-text-3)" }}>{t("saving")}</span> : t("saved")}
    </div>
  );
}

Object.assign(window, { IcLock, IcBack, IcCheck, IcChev, TabIcon, Avatar, PointsTag, MatchCard, Stepper, SavedPill });
