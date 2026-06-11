/* Quiniela — Leaderboard, member profile, Me */
const EB = window.QEngine;

function LeaderboardScreen({ lang, t, me, results, voided, emptyBoard, onProfile }) {
  const rows = EB.standings(window.Q_MEMBERS, window.Q_MATCHES, window.Q_PICKS, emptyBoard ? {} : results, voided)
    .filter((row) => { const mb = window.Q_MEMBERS.find((x) => x.id === row.id); return mb.claimed || mb.id === me.id; });
  const anyFinal = !emptyBoard && window.Q_MATCHES.some((m) => EB.statusOf(m, window.Q_NOW, results, voided) === "final");

  return (
    <React.Fragment>
      <header className="hd">
        <div className="hd-row"><h1 className="hd-title">{t("tabBoard")}</h1></div>
      </header>
      <div className="app-scroll" data-screen-label="Leaderboard">
        {!anyFinal ? (
          <div className="lb-empty">
            <span className="big">⚽</span>
            <h2>{t("boardEmptyTitle")}</h2>
            <p>{t("boardEmptyBody")}</p>
          </div>
        ) : (
          <div className="lb">
            {rows.map((row) => {
              const mb = window.Q_MEMBERS.find((x) => x.id === row.id);
              const isMe = row.id === me.id;
              const top = row.rank <= 3;
              return (
                <button key={row.id}
                  className={"lb-row" + (top ? " lb-row--top" : "") + (isMe ? " lb-row--me" : "")}
                  onClick={() => onProfile(row.id)}>
                  <span className="lb-rank">{(row.tied ? "T-" : "") + row.rank}</span>
                  <Avatar member={mb} size={top ? "lg" : undefined} />
                  <span className="lb-name">
                    {isMe ? me.name : mb.name}
                    {isMe && <span className="chip chip--void">{t("youChip")}</span>}
                  </span>
                  <span className="lb-exact">{row.exact} {t("exactShort")}</span>
                  <span className={"lb-move " + (row.move > 0 ? "lb-move--up" : row.move < 0 ? "lb-move--down" : "lb-move--flat")}>
                    {row.move > 0 ? "▲" : row.move < 0 ? "▼" : "–"}
                  </span>
                  <span className="lb-pts">{row.pts}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

/* shared pick-history list (locked matches only) */
function HistoryList({ memberId, meId, getPick, lang, t, results, voided, title }) {
  const rows = window.Q_MATCHES
    .filter((m) => EB.isLocked(EB.statusOf(m, window.Q_NOW, results, voided)) || EB.statusOf(m, window.Q_NOW, results, voided) === "void")
    .sort((a, b) => b.ko - a.ko)
    .map((m) => {
      const st = EB.statusOf(m, window.Q_NOW, results, voided);
      const p = memberId === meId ? getPick(m.id) : (window.Q_PICKS[m.id] || {})[memberId];
      const r = EB.resultOf(m, results);
      const s = st === "final" ? EB.scorePick(p, m, r) : null;
      return { m, st, p, r, s };
    });
  return (
    <div className="sect">
      <div className="sect-h">{title}</div>
      {rows.map(({ m, st, p, r, s }) => (
        <div key={m.id} className="hrow">
          <span className="hrow-flags">{window.Q_TEAMS[m.home].flag} {window.Q_TEAMS[m.away].flag}</span>
          <span className="hrow-label">
            {m.home} {p && p.h != null ? p.h + "–" + p.a : "—"} {m.away}
            <span className="hrow-sub">
              {st === "final" ? t("resultRow") + " " + r.h + "–" + r.a
                : st === "void" ? t("voidTag")
                : st === "live" ? t("live") : t("awaitingResult")}
            </span>
          </span>
          {st === "final" ? <PointsTag tag={s ? s.tag : "none"} pts={s ? s.pts : 0} t={t} />
            : st === "void" ? <span className="chip chip--void">—</span>
            : <span style={{ color: "var(--color-text-3)" }}><IcLock /></span>}
        </div>
      ))}
      {rows.length === 0 && <div className="hrow"><span className="hrow-label" style={{ color: "var(--color-text-3)" }}>—</span></div>}
    </div>
  );
}

function ProfileScreen({ memberId, lang, t, me, getPick, results, voided, onBack }) {
  const mb = window.Q_MEMBERS.find((x) => x.id === memberId);
  const rows = EB.standings(window.Q_MEMBERS, window.Q_MATCHES, window.Q_PICKS, results, voided);
  const row = rows.find((x) => x.id === memberId) || { pts: 0, exact: 0, rank: "–" };
  return (
    <div data-screen-label={"Profile " + mb.name}>
      <div className="dt-top">
        <button className="backbtn" onClick={onBack} aria-label={t("back")}><IcBack /></button>
        <span className="dt-stage">{mb.name}</span>
        <span className="dt-spacer"></span>
      </div>
      <div className="app-scroll">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 0 18px" }}>
          <Avatar member={mb} size="xl" />
          <div style={{ font: "var(--text-heading)" }}>{mb.name}</div>
        </div>
        <div className="statgrid">
          <div className="stat"><div className="v">{row.pts}</div><div className="l">{t("statPoints")}</div></div>
          <div className="stat"><div className="v">{row.exact}</div><div className="l">{t("statExact")}</div></div>
          <div className="stat"><div className="v">{(row.tied ? "T-" : "") + row.rank}</div><div className="l">{t("statRank")}</div></div>
        </div>
        <HistoryList memberId={memberId} meId={me.id} getPick={getPick} lang={lang} t={t}
          results={results} voided={voided} title={t("profileHistory")} />
      </div>
    </div>
  );
}

function MeScreen({ lang, t, me, setLang, setAvatar, getPick, results, voided, onAdmin }) {
  const [picking, setPicking] = React.useState(false);
  const rows = EB.standings(window.Q_MEMBERS, window.Q_MATCHES, window.Q_PICKS, results, voided);
  const row = rows.find((x) => x.id === me.id) || { pts: 0, exact: 0, rank: "–" };
  return (
    <React.Fragment>
      <header className="hd">
        <div className="hd-row"><h1 className="hd-title">{t("tabMe")}</h1></div>
      </header>
      <div className="app-scroll" data-screen-label="Me">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0 16px" }}>
          <button style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }} onClick={() => setPicking(!picking)}>
            <Avatar member={me} size="xl" />
          </button>
          <div style={{ font: "var(--text-heading)" }}>{me.name}</div>
          <div style={{ font: "var(--text-caption)", color: "var(--color-text-3)" }}>{t("meAvatar")}</div>
        </div>
        {picking && (
          <div className="join-avgrid" style={{ marginTop: 0 }}>
            {window.Q_EMOJIS.map((e) => (
              <button key={e} className={"join-av" + (me.emoji === e ? " on" : "")}
                onClick={() => { setAvatar(e); setPicking(false); }}>{e}</button>
            ))}
          </div>
        )}
        <div className="statgrid">
          <div className="stat"><div className="v">{row.pts}</div><div className="l">{t("statPoints")}</div></div>
          <div className="stat"><div className="v">{row.exact}</div><div className="l">{t("statExact")}</div></div>
          <div className="stat"><div className="v">{(row.tied ? "T-" : "") + row.rank}</div><div className="l">{t("statRank")}</div></div>
        </div>
        <div className="sect">
          <div className="sect-h">{t("meLanguage")}</div>
          <div style={{ padding: "10px 16px 16px" }}>
            <div className="seg">
              <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>Español</button>
              <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button>
            </div>
          </div>
        </div>
        <HistoryList memberId={me.id} meId={me.id} getPick={getPick} lang={lang} t={t}
          results={results} voided={voided} title={t("meHistory")} />
        {me.admin && (
          <div className="sect">
            <div className="sect-h">{t("meAdmin")}</div>
            <button className="row" onClick={() => onAdmin("results")}>
              <span className="grow">{t("meResults")}</span><IcChev />
            </button>
            <button className="row" onClick={() => onAdmin("members")}>
              <span className="grow">{t("meMembers")}</span><IcChev />
            </button>
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { LeaderboardScreen, ProfileScreen, MeScreen, HistoryList });
