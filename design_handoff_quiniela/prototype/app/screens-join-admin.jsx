/* Quiniela — Join flow + Admin (results entry, members) */
const EA = window.QEngine;

/* ---------- Join (invite link first-visit) ---------- */
function JoinScreen({ lang, setLang, t, joinState, onJoin }) {
  const [picked, setPicked] = React.useState(null);
  const [emoji, setEmoji] = React.useState(null);
  const unclaimed = window.Q_MEMBERS.filter((m) => !m.claimed);
  const showList = joinState === "normal" && (unclaimed.length > 0);

  const LangSeg = (
    <div className="join-lang">
      <div className="seg">
        <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
        <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      </div>
    </div>
  );

  if (joinState === "invalid") {
    return (
      <div className="join" data-screen-label="Join — invalid link">
        {LangSeg}
        <div className="join-empty">
          <span className="big">🔗</span>
          <h1 style={{ font: "var(--text-heading)", fontSize: 20, margin: 0 }}>{t("joinInvalidTitle")}</h1>
          <p className="sub" style={{ margin: 0 }}>{t("joinInvalidBody")}</p>
        </div>
      </div>
    );
  }
  if (joinState === "claimed" || !showList) {
    return (
      <div className="join" data-screen-label="Join — all claimed">
        {LangSeg}
        <div className="join-empty">
          <span className="big">🙈</span>
          <h1 style={{ font: "var(--text-heading)", fontSize: 20, margin: 0 }}>{t("joinClaimedTitle")}</h1>
          <p className="sub" style={{ margin: 0 }}>{t("joinClaimedBody")}</p>
        </div>
      </div>
    );
  }
  if (picked) {
    return (
      <div className="join" data-screen-label="Join — avatar">
        {LangSeg}
        <h1>{t("joinAvatarTitle")}</h1>
        <p className="sub">{t("joinAvatarSub")}</p>
        <div className="join-avgrid">
          {window.Q_EMOJIS.slice(0, 15).map((e) => (
            <button key={e} className={"join-av" + (emoji === e ? " on" : "")} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <button className="cta" onClick={() => onJoin(picked, emoji)}>{t("joinGo")}</button>
        <button className="ghostbtn" style={{ marginTop: 10, border: "none" }} onClick={() => onJoin(picked, null)}>{t("skip")}</button>
      </div>
    );
  }
  return (
    <div className="join" data-screen-label="Join — who are you">
      {LangSeg}
      <h1>{t("joinTitle")}</h1>
      <p className="sub">{t("joinSub")}</p>
      <div className="join-grid">
        {unclaimed.map((m) => (
          <button key={m.id} className="join-name" onClick={() => setPicked(m.id)}>
            <Avatar member={{ name: m.name }} /> {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Admin: results entry ---------- */
function AdminResults({ lang, t, results, voided, corrected, setResult, setVoid, onBack }) {
  const [editing, setEditing] = React.useState(null);   // match id
  const [draft, setDraft] = React.useState({});
  const [confirming, setConfirming] = React.useState(false);
  const [voiding, setVoiding] = React.useState(false);

  const awaiting = window.Q_MATCHES
    .filter((m) => EA.statusOf(m, window.Q_NOW, results, voided) === "awaiting")
    .sort((a, b) => a.ko - b.ko);
  const entered = window.Q_MATCHES
    .filter((m) => EA.statusOf(m, window.Q_NOW, results, voided) === "final")
    .sort((a, b) => b.ko - a.ko);

  const open = (m) => {
    const r = EA.resultOf(m, results);
    setDraft(r ? Object.assign({}, r) : {});
    setEditing(m.id);
  };

  if (editing) {
    const m = window.Q_MATCHES.find((x) => x.id === editing);
    const isEdit = !!EA.resultOf(m, results);
    const needsAdv = EA.isKO(m) && draft.h != null && draft.h === draft.a;
    const complete = draft.h != null && draft.a != null && (!needsAdv || draft.adv);
    const impact = complete ? EA.impactOf(m, draft, window.Q_PICKS, window.Q_MEMBERS.filter((x) => x.claimed)) : null;
    return (
      <div data-screen-label="Admin result entry">
        <div className="dt-top">
          <button className="backbtn" onClick={() => setEditing(null)} aria-label={t("back")}><IcBack /></button>
          <span className="dt-stage">{t("enterResult")} · {m.home}–{m.away}</span>
          <span className="dt-spacer"></span>
        </div>
        <div className="app-scroll">
          <div className="steps">
            <Stepper label={m.home} value={draft.h == null ? null : draft.h} onChange={(v) => setDraft(Object.assign({}, draft, { h: v, a: draft.a == null ? 0 : draft.a, adv: undefined }))} />
            <Stepper label={m.away} value={draft.a == null ? null : draft.a} onChange={(v) => setDraft(Object.assign({}, draft, { a: v, h: draft.h == null ? 0 : draft.h, adv: undefined }))} />
          </div>
          {needsAdv && (
            <div className="adv">
              <div className="adv-q">{t("whoAdvances")}</div>
              <div className="adv-btns">
                {[m.home, m.away].map((code) => (
                  <button key={code} className={"adv-btn" + (draft.adv === code ? " on" : "")}
                    onClick={() => setDraft(Object.assign({}, draft, { adv: code }))}>
                    <span>{window.Q_TEAMS[code].flag}</span> {code}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16 }}>
            <button className="cta" disabled={!complete} onClick={() => setConfirming(true)}>{t("saveResult")}</button>
            <button className="ghostbtn danger" style={{ borderColor: "var(--color-live)" }} onClick={() => setVoiding(true)}>{t("markVoid")}</button>
          </div>
        </div>

        {confirming && impact && (
          <div className="ovl" onClick={() => setConfirming(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <h2>{t("confirmTitle")} — {m.home} {draft.h}–{draft.a} {m.away}{draft.adv ? " · " + t("advances", { team: draft.adv }) : ""}</h2>
              <p>{t("confirmBody")}</p>
              <div className="sheet-impact">
                <span className="chip chip--exact">{t("impExact", { n: impact.exact })}</span>
                <span className="chip chip--outcome">{t("impOutcome", { n: impact.outcome })}</span>
                {EA.isKO(m) && <span className="chip chip--outcome">{t("impDraw", { n: impact.draw })}</span>}
                <span className="chip chip--void">{t("impMiss", { n: impact.miss })}</span>
                <span className="chip chip--void">{t("impNone", { n: impact.none })}</span>
              </div>
              <div className="sheet-btns">
                <button className="ghostbtn" onClick={() => setConfirming(false)}>{t("cancel")}</button>
                <button className="cta" onClick={() => { setResult(m.id, draft, isEdit); setConfirming(false); setEditing(null); }}>{t("confirm")}</button>
              </div>
            </div>
          </div>
        )}
        {voiding && (
          <div className="ovl" onClick={() => setVoiding(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <h2>{t("markVoid")} — {m.home}–{m.away}</h2>
              <p>{t("voidBody")}</p>
              <div className="sheet-btns">
                <button className="ghostbtn" onClick={() => setVoiding(false)}>{t("cancel")}</button>
                <button className="cta cta--danger" onClick={() => { setVoid(m.id); setVoiding(false); setEditing(null); }}>{t("confirm")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-screen-label="Admin results list">
      <div className="dt-top">
        <button className="backbtn" onClick={onBack} aria-label={t("back")}><IcBack /></button>
        <span className="dt-stage">{t("meResults")}</span>
        <span className="dt-spacer"></span>
      </div>
      <div className="app-scroll">
        <div className="sect">
          <div className="sect-h">{t("adminAwaiting")}</div>
          {awaiting.length === 0 && <div className="hrow"><span className="hrow-label" style={{ color: "var(--color-text-3)" }}>{t("adminNoAwaiting")}</span></div>}
          {awaiting.map((m) => (
            <button key={m.id} className="row" onClick={() => open(m)}>
              <span className="hrow-flags">{window.Q_TEAMS[m.home].flag} {window.Q_TEAMS[m.away].flag}</span>
              <span className="grow">{m.home} – {m.away}
                <span className="sub">{EA.stageLabel(m, t)} · {EA.fmtDay(m.ko, lang, t)}, {EA.fmtTime(m.ko, lang)}</span>
              </span>
              <span className="chip chip--postponed">{t("adminAwaiting")}</span>
              <IcChev />
            </button>
          ))}
        </div>
        <div className="sect">
          <div className="sect-h">{t("adminEntered")}</div>
          {entered.map((m) => {
            const r = EA.resultOf(m, results);
            return (
              <button key={m.id} className="row" onClick={() => open(m)}>
                <span className="hrow-flags">{window.Q_TEAMS[m.home].flag} {window.Q_TEAMS[m.away].flag}</span>
                <span className="grow">{m.home} {r.h}–{r.a} {m.away}
                  {corrected[m.id] && <span className="sub corr">{t("editedTag")}</span>}
                </span>
                <span style={{ font: "var(--text-label)", color: "var(--color-text-3)" }}>{t("editResult")}</span>
                <IcChev />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Admin: members ---------- */
function AdminMembers({ lang, t, onBack, bump }) {
  const [copied, setCopied] = React.useState(false);
  const [token, setToken] = React.useState("fam-2026-x7k2");
  const [name, setName] = React.useState("");
  const [releasing, setReleasing] = React.useState(null);

  const copy = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const regen = () => setToken("fam-2026-" + Math.random().toString(36).slice(2, 6));
  const add = () => {
    const nm = name.trim(); if (!nm) return;
    window.Q_MEMBERS.push({ id: "x" + Date.now(), name: nm, emoji: null, claimed: false });
    setName(""); bump();
  };
  const release = (m) => { m.claimed = false; setReleasing(null); bump(); };

  return (
    <div data-screen-label="Admin members">
      <div className="dt-top">
        <button className="backbtn" onClick={onBack} aria-label={t("back")}><IcBack /></button>
        <span className="dt-stage">{t("meMembers")}</span>
        <span className="dt-spacer"></span>
      </div>
      <div className="app-scroll">
        <div className="sect">
          <div className="sect-h">{t("inviteLink")}</div>
          <div className="invite">
            <code>quiniela.app/j/{token}</code>
            <button className="ghostbtn" onClick={copy}>{copied ? t("copied") : t("copy")}</button>
            <button className="ghostbtn" onClick={regen}>{t("regen")}</button>
          </div>
        </div>
        <div className="sect">
          <div className="addname">
            <input value={name} placeholder={t("addName")} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="ghostbtn" onClick={add}>+</button>
          </div>
          {window.Q_MEMBERS.map((m) => (
            <div key={m.id} className="row" style={{ cursor: "default" }}>
              <Avatar member={m} />
              <span className="grow">{m.name}
                <span className="sub">{m.claimed ? t("claimed") : t("unclaimed")}</span>
              </span>
              {m.claimed && <button className="ghostbtn" onClick={() => setReleasing(m.id)}>{t("release")}</button>}
            </div>
          ))}
        </div>
      </div>
      {releasing && (
        <div className="ovl" onClick={() => setReleasing(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{t("release")} — {window.Q_MEMBERS.find((x) => x.id === releasing).name}</h2>
            <p>{t("releaseBody", { name: window.Q_MEMBERS.find((x) => x.id === releasing).name })}</p>
            <div className="sheet-btns">
              <button className="ghostbtn" onClick={() => setReleasing(null)}>{t("cancel")}</button>
              <button className="cta" onClick={() => release(window.Q_MEMBERS.find((x) => x.id === releasing))}>{t("confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { JoinScreen, AdminResults, AdminMembers });
