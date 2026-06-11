/* Quiniela — app shell: routing, state, tweaks, device frame */
const ES = window.QEngine;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#252b36",
  "joinState": "normal",
  "emptyBoard": false
}/*EDITMODE-END*/;

/* apply persisted "my picks" into the shared picks table before first render */
(function hydrate() {
  try {
    const u = JSON.parse(localStorage.getItem("quiniela_user") || "null");
    if (u) {
      const mb = window.Q_MEMBERS.find((x) => x.id === u.id);
      if (mb) { mb.claimed = true; if (u.emoji) mb.emoji = u.emoji; }
    }
    const mine = JSON.parse(localStorage.getItem("quiniela_my_picks") || "{}");
    if (u) Object.keys(mine).forEach((mid) => {
      (window.Q_PICKS[mid] = window.Q_PICKS[mid] || {})[u.id] = mine[mid];
    });
  } catch (e) { /* fresh start */ }
})();

function QuinielaApp() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [, bumpN] = React.useReducer((x) => x + 1, 0);
  const bump = () => bumpN();

  const [lang, setLangState] = React.useState(() =>
    localStorage.getItem("quiniela_lang") ||
    ((navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en"));
  const setLang = (l) => { setLangState(l); localStorage.setItem("quiniela_lang", l); };
  const t = window.makeT(lang);

  const [userId, setUserId] = React.useState(() => {
    try { return (JSON.parse(localStorage.getItem("quiniela_user") || "null") || {}).id || null; }
    catch (e) { return null; }
  });
  const me = userId ? window.Q_MEMBERS.find((x) => x.id === userId) : null;

  /* admin-entered results / voids / corrections (persisted) */
  const [adminResults, setAdminResults] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("quiniela_results") || "{}"); } catch (e) { return {}; }
  });
  const [voided, setVoided] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("quiniela_voided") || "{}"); } catch (e) { return {}; }
  });
  const [corrected, setCorrected] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("quiniela_corrected") || "{}"); } catch (e) { return {}; }
  });
  const setResult = (mid, r, isEdit) => {
    const next = Object.assign({}, adminResults); next[mid] = r;
    setAdminResults(next); localStorage.setItem("quiniela_results", JSON.stringify(next));
    if (isEdit) { const c = Object.assign({}, corrected); c[mid] = true; setCorrected(c); localStorage.setItem("quiniela_corrected", JSON.stringify(c)); }
  };
  const setVoid = (mid) => {
    const next = Object.assign({}, voided); next[mid] = true;
    setVoided(next); localStorage.setItem("quiniela_voided", JSON.stringify(next));
  };

  /* my picks */
  const getPick = (mid) => (me ? (window.Q_PICKS[mid] || {})[me.id] : null);
  const setPick = (mid, pick) => {
    if (!me) return;
    (window.Q_PICKS[mid] = window.Q_PICKS[mid] || {})[me.id] = pick;
    try {
      const mine = JSON.parse(localStorage.getItem("quiniela_my_picks") || "{}");
      mine[mid] = pick; localStorage.setItem("quiniela_my_picks", JSON.stringify(mine));
    } catch (e) { /* ignore */ }
    bump();
  };

  /* routing */
  const [tab, setTab] = React.useState("matches");
  const [detail, setDetail] = React.useState(null);
  const [profile, setProfile] = React.useState(null);
  const [admin, setAdmin] = React.useState(null);

  /* add-to-home-screen hint after first saved pick */
  const [a2hs, setA2hs] = React.useState(false);
  const onFirstSave = () => {
    if (!localStorage.getItem("quiniela_a2hs")) {
      localStorage.setItem("quiniela_a2hs", "1");
      setTimeout(() => setA2hs(true), 900);
    }
  };

  const onJoin = (id, emoji) => {
    const mb = window.Q_MEMBERS.find((x) => x.id === id);
    mb.claimed = true; if (emoji) mb.emoji = emoji;
    localStorage.setItem("quiniela_user", JSON.stringify({ id, emoji: emoji || null }));
    setUserId(id);
  };
  const setAvatar = (emoji) => {
    me.emoji = emoji;
    localStorage.setItem("quiniela_user", JSON.stringify({ id: me.id, emoji }));
    bump();
  };

  const pending = me ? ES.pendingMatches(me.id, window.Q_MATCHES, window.Q_PICKS, adminResults, voided) : [];

  const accentStyle = {
    "--color-accent": tw.accent, "--color-accent-hover": tw.accent,
  };

  let body;
  if (!me) {
    body = <JoinScreen lang={lang} setLang={setLang} t={t} joinState={tw.joinState} onJoin={onJoin} />;
  } else if (admin === "results") {
    body = <AdminResults lang={lang} t={t} results={adminResults} voided={voided} corrected={corrected}
      setResult={setResult} setVoid={setVoid} onBack={() => setAdmin(null)} />;
  } else if (admin === "members") {
    body = <AdminMembers lang={lang} t={t} onBack={() => setAdmin(null)} bump={bump} />;
  } else if (detail) {
    body = <DetailScreen matchId={detail} lang={lang} t={t} me={me} getPick={getPick} setPick={setPick}
      results={adminResults} voided={voided} corrected={corrected}
      onBack={() => setDetail(null)} onFirstSave={onFirstSave} />;
  } else if (profile) {
    body = <ProfileScreen memberId={profile} lang={lang} t={t} me={me} getPick={getPick}
      results={adminResults} voided={voided} onBack={() => setProfile(null)} />;
  } else if (tab === "matches") {
    body = <MatchesScreen lang={lang} t={t} me={me} getPick={getPick} results={adminResults} voided={voided}
      corrected={corrected} onOpen={setDetail} pending={pending} />;
  } else if (tab === "board") {
    body = <LeaderboardScreen lang={lang} t={t} me={me} results={adminResults} voided={voided}
      emptyBoard={tw.emptyBoard} onProfile={setProfile} />;
  } else {
    body = <MeScreen lang={lang} t={t} me={me} setLang={setLang} setAvatar={setAvatar} getPick={getPick}
      results={adminResults} voided={voided} onAdmin={setAdmin} />;
  }

  const showTabs = me && !detail && !profile && !admin;

  return (
    <div className="app" style={accentStyle} data-screen-label={tab}>
      {body}
      {showTabs && (
        <nav className="tabbar">
          {[["matches", t("tabMatches")], ["board", t("tabBoard")], ["me", t("tabMe")]].map(([k, label]) => (
            <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => { setTab(k); }}>
              {k === "matches" && pending.length > 0 && <span className="tdot"></span>}
              <TabIcon kind={k} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {a2hs && (
        <div className="toast" data-comment-anchor="a2hs-hint">
          <span style={{ fontSize: 22 }}>📌</span>
          <span className="grow"><strong>{t("a2hsTitle")}</strong><br />{t("a2hsBody")}</span>
          <button onClick={() => setA2hs(false)}>{t("a2hsCta")}</button>
        </div>
      )}
      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={tw.accent}
          options={["#252b36", "oklch(0.46 0.11 155)", "oklch(0.45 0.1 250)", "oklch(0.5 0.16 25)"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Language" />
        <TweakRadio label="UI language" value={lang} options={["es", "en"]} onChange={setLang} />
        <TweakSection label="Demo states" />
        <TweakRadio label="Join screen" value={tw.joinState} options={["normal", "claimed", "invalid"]}
          onChange={(v) => setTweak("joinState", v)} />
        <TweakToggle label="Empty leaderboard" value={tw.emptyBoard} onChange={(v) => setTweak("emptyBoard", v)} />
        <TweakButton label="Reset to first visit" onClick={() => {
          ["quiniela_user", "quiniela_my_picks", "quiniela_results", "quiniela_voided", "quiniela_corrected", "quiniela_a2hs"].forEach((k) => localStorage.removeItem(k));
          location.reload();
        }} />
      </TweaksPanel>
    </div>
  );
}

/* center + scale the device to the viewport */
function Shell() {
  const [vh, setVh] = React.useState(window.innerHeight);
  React.useEffect(() => {
    const r = () => setVh(window.innerHeight);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  const scale = Math.min(1, (vh - 28) / 874, (window.innerWidth - 16) / 402);
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "oklch(0.93 0.01 250)", overflow: "hidden" }}>
      <div style={{ width: 402 * scale, height: 874 * scale }}>
        <div style={{ transform: "scale(" + scale + ")", transformOrigin: "top left" }}>
          <IOSDevice>
            <QuinielaApp />
          </IOSDevice>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Shell />);
