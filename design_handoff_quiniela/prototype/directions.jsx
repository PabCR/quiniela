/* Quiniela — match card direction explorations (canvas content) */

const Lock = ({ size = 13 }) => (
  <svg className="lock-ic" width={size} height={size} viewBox="0 0 14 14" fill="none" aria-label="locked">
    <rect x="2.2" y="6.2" width="9.6" height="6.3" rx="2" fill="currentColor"></rect>
    <path d="M4.6 6V4.6a2.4 2.4 0 0 1 4.8 0V6" stroke="currentColor" strokeWidth="1.6" fill="none"></path>
  </svg>
);

const Anno = ({ children }) => <div className="anno">{children}</div>;

const PhoneHead = ({ title, badge, date }) => (
  <React.Fragment>
    <div className="ph-head">
      <h1 className="ph-title">{title}</h1>
      <span className="ph-badge"><span className="dot"></span>{badge}</span>
    </div>
    <div className="ph-date">{date}</div>
  </React.Fragment>
);

/* ================= DIRECTION A · SOFT TILES ================= */

const CATeam = ({ flag, code }) => (
  <div className="ca-team"><span className="ca-flag">{flag}</span><span className="ca-code">{code}</span></div>
);

const CardA = ({ cls, left, right, center, meta }) => (
  <div className={"ca " + (cls || "")}>
    <div className="ca-row">
      <CATeam flag={left[0]} code={left[1]} />
      <div className="ca-center">{center}</div>
      <CATeam flag={right[0]} code={right[1]} />
    </div>
    <div className="ca-meta">{meta}</div>
  </div>
);

const DirectionA = () => (
  <div className="ph">
    <PhoneHead title="Matches" badge="3 picks pending" date="Today · Sat, Jun 13" />

    <Anno>1 · Upcoming, no pick — primary CTA</Anno>
    <CardA left={["🇩🇪", "GER"]} right={["🇨🇼", "CUW"]}
      center={<button className="ca-cta">Make your pick</button>}
      meta={<React.Fragment><span>Group E</span>·<span>Tomorrow, 12:00</span></React.Fragment>} />

    <Anno>7 · &lt;2h to kickoff, no pick — urgency wash + countdown</Anno>
    <CardA cls="ca--urgent" left={["🇧🇷", "BRA"]} right={["🇲🇦", "MAR"]}
      center={<React.Fragment>
        <span className="chip chip--urgent">Locks in 1h 24m</span>
        <button className="ca-cta">Make your pick</button>
      </React.Fragment>}
      meta={<React.Fragment><span>Group C</span>·<span>Today, 18:00</span></React.Fragment>} />

    <Anno>2 · Upcoming, picked — editable until kickoff</Anno>
    <CardA left={["🇭🇹", "HAI"]} right={["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "SCO"]}
      center={<React.Fragment>
        <span className="ca-overline">Your pick</span>
        <span className="ca-score">1 – 2</span>
      </React.Fragment>}
      meta={<React.Fragment><span>Group C</span>·<span>Today, 21:00</span>·<span style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Edit</span></React.Fragment>} />

    <Anno>3 · Locked / live — pick frozen</Anno>
    <CardA cls="ca--live" left={["🇶🇦", "QAT"]} right={["🇨🇭", "SUI"]}
      center={<React.Fragment>
        <span className="chip chip--live"><span className="livedot"></span>Live · 64′</span>
        <span className="ca-score" style={{ color: "var(--color-locked)" }}><Lock size={15} /> 0 – 2</span>
      </React.Fragment>}
      meta={<React.Fragment><span>Group B</span>·<span>Your pick is locked</span></React.Fragment>} />

    <Anno>4 · Final — result + my points</Anno>
    <CardA cls="ca--exact" left={["🇲🇽", "MEX"]} right={["🇿🇦", "RSA"]}
      center={<React.Fragment>
        <span className="ca-overline">Final</span>
        <span className="ca-score">2 – 1</span>
        <span className="chip chip--exact-soft">Exact · +3</span>
      </React.Fragment>}
      meta={<React.Fragment><span>Group A</span>·<span>You picked 2–1</span></React.Fragment>} />

    <Anno>5 · Void — not scored</Anno>
    <CardA cls="ca--void" left={["🇰🇷", "KOR"]} right={["🇨🇿", "CZE"]}
      center={<React.Fragment>
        <span className="ca-score ca-score--muted">—</span>
        <span className="chip chip--void">Void · Not scored</span>
      </React.Fragment>}
      meta={<React.Fragment><span>Group A</span>·<span>Played Jun 11</span></React.Fragment>} />

    <Anno>6 · Postponed — new date noted</Anno>
    <CardA left={["🇦🇺", "AUS"]} right={["🇹🇷", "TUR"]}
      center={<React.Fragment>
        <span className="ca-overline">Postponed</span>
        <span className="chip chip--postponed">New date · Sun, Jun 14</span>
      </React.Fragment>}
      meta={<React.Fragment><span>Group D</span>·<span>Pick stays open</span></React.Fragment>} />
  </div>
);

/* ================= DIRECTION B · INK LEDGER (Spanish) ================= */

const CBRow = ({ flag, name, num, ghost, sub }) => (
  <div className="cb-trow">
    <span className="cb-flag">{flag}</span>
    <span className="cb-name">{name}</span>
    {sub !== undefined && <span className="cb-mypick">{sub}</span>}
    <span className={"cb-num" + (ghost ? " cb-num--ghost" : "")}>{num}</span>
  </div>
);

const CardB = ({ cls, rows, meta, action, extra }) => (
  <div className={"cb " + (cls || "")}>
    <div>{rows}</div>
    <div className="cb-foot">
      <span className="cb-meta">{meta}</span>
      {action}
    </div>
    {extra}
  </div>
);

const DirectionB = () => (
  <div className="ph">
    <PhoneHead title="Partidos" badge="3 pronósticos pendientes" date="Hoy · sáb, 13 jun" />

    <Anno>1 · Próximo, sin pronóstico</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇩🇪" name="Alemania" num="–" ghost />
        <CBRow flag="🇨🇼" name="Curazao" num="–" ghost />
      </React.Fragment>}
      meta="Grupo E · Mañana, 12:00"
      action={<button className="cb-pill">Pronosticar</button>} />

    <Anno>7 · Cierra en &lt;2h, sin pronóstico</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇧🇷" name="Brasil" num="–" ghost />
        <CBRow flag="🇲🇦" name="Marruecos" num="–" ghost />
      </React.Fragment>}
      meta="Grupo C · Hoy, 18:00"
      action={null}
      extra={<div className="cb-urgent"><span>Cierra en 1 h 24 min</span><button className="cb-pill" style={{ background: "var(--color-urgent)" }}>Pronosticar</button></div>} />

    <Anno>2 · Próximo, con pronóstico</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇭🇹" name="Haití" num="1" />
        <CBRow flag="🏴󠁧󠁢󠁳󠁣󠁴󠁿" name="Escocia" num="2" />
      </React.Fragment>}
      meta="Grupo C · Hoy, 21:00"
      action={<button className="cb-ghostbtn">Editar</button>} />

    <Anno>3 · Bloqueado / en vivo</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇶🇦" name="Catar" num="0" />
        <CBRow flag="🇨🇭" name="Suiza" num="2" />
      </React.Fragment>}
      meta={<span className="cb-meta--live"><span className="livedot"></span>En vivo · 64′</span>}
      action={<span className="chip chip--void"><Lock /> Tu pronóstico</span>} />

    <Anno>4 · Final — resultado grande, mi pronóstico al lado</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇲🇽" name="México" num="2" sub="2" />
        <CBRow flag="🇿🇦" name="Sudáfrica" num="1" sub="1" />
      </React.Fragment>}
      meta="Final · Pronosticaste 2–1"
      action={<span className="chip chip--exact">Exacto · +3</span>} />

    <Anno>5 · Anulado</Anno>
    <CardB cls="cb--void"
      rows={<React.Fragment>
        <CBRow flag="🇰🇷" name="Corea del Sur" num="–" ghost />
        <CBRow flag="🇨🇿" name="Chequia" num="–" ghost />
      </React.Fragment>}
      meta="Grupo A · 11 jun"
      action={<span className="chip chip--void">No puntúa</span>} />

    <Anno>6 · Aplazado</Anno>
    <CardB
      rows={<React.Fragment>
        <CBRow flag="🇦🇺" name="Australia" num="–" ghost />
        <CBRow flag="🇹🇷" name="Turquía" num="–" ghost />
      </React.Fragment>}
      meta="Nueva fecha · dom 14, 21:00"
      action={<span className="chip chip--postponed">Aplazado</span>} />
  </div>
);

/* ================= DIRECTION C · SCOREBOARD CAPSULE ================= */

const CCTeam = ({ flag, code, name }) => (
  <div className="cc-team">
    <span className="cc-flag">{flag}</span>
    <span className="cc-code">{code}</span>
    <span className="cc-nm">{name}</span>
  </div>
);

const CardC = ({ cls, left, right, over, overCls, cap, foot, footCls }) => (
  <div className={"cc " + (cls || "")}>
    <div className="cc-row">
      <CCTeam flag={left[0]} code={left[1]} name={left[2]} />
      <div className="cc-capwrap">
        <span className={"cc-capover " + (overCls || "")}>{over}</span>
        {cap}
      </div>
      <CCTeam flag={right[0]} code={right[1]} name={right[2]} />
    </div>
    <div className={"cc-foot " + (footCls || "")}>{foot}</div>
  </div>
);

const DirectionC = () => (
  <div className="ph">
    <PhoneHead title="Matches" badge="3 picks pending" date="Today · Sat, Jun 13" />

    <Anno>1 · Upcoming, no pick — the capsule IS the button</Anno>
    <CardC left={["🇩🇪", "GER", "Germany"]} right={["🇨🇼", "CUW", "Curaçao"]}
      over="" cap={<button className="cc-cap cc-cap--cta">Pick</button>}
      foot={<span>Group E · Tomorrow, 12:00</span>} />

    <Anno>7 · &lt;2h, no pick — urgent capsule + countdown</Anno>
    <CardC left={["🇧🇷", "BRA", "Brazil"]} right={["🇲🇦", "MAR", "Morocco"]}
      over="" cap={<button className="cc-cap cc-cap--cta is-urgent">Pick</button>}
      foot={<span>Locks in 1h 24m · Today, 18:00</span>} footCls="cc-foot--urgent" />

    <Anno>2 · Upcoming, picked — tap capsule to edit</Anno>
    <CardC left={["🇭🇹", "HAI", "Haiti"]} right={["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "SCO", "Scotland"]}
      over="Your pick"
      cap={<button className="cc-cap" style={{ cursor: "pointer" }}>
        <span className="cc-capscore">1–2</span>
        <span className="cc-caplabel">Tap to edit</span>
      </button>}
      foot={<span>Group C · Today, 21:00</span>} />

    <Anno>3 · Locked / live</Anno>
    <CardC left={["🇶🇦", "QAT", "Qatar"]} right={["🇨🇭", "SUI", "Switzerland"]}
      over={<React.Fragment><span className="livedot"></span>Live · 64′</React.Fragment>} overCls="cc-capover--live"
      cap={<div className="cc-cap cc-cap--locked">
        <span className="cc-capscore"><Lock size={14} /> 0–2</span>
        <span className="cc-caplabel">Your pick</span>
      </div>}
      foot={<span>Group B · Kicked off 17:00</span>} />

    <Anno>4 · Final — result owns the capsule</Anno>
    <CardC left={["🇲🇽", "MEX", "Mexico"]} right={["🇿🇦", "RSA", "South Africa"]}
      over="Final"
      cap={<div className="cc-cap cc-cap--final">
        <span className="cc-capscore">2–1</span>
        <span className="cc-caplabel">You picked 2–1</span>
      </div>}
      foot={<React.Fragment><span className="chip chip--exact">Exact · +3</span></React.Fragment>} />

    <Anno>5 · Void</Anno>
    <CardC cls="cc--void" left={["🇰🇷", "KOR", "South Korea"]} right={["🇨🇿", "CZE", "Czechia"]}
      over=""
      cap={<div className="cc-cap cc-cap--void"><span className="cc-capscore">—</span></div>}
      foot={<span>Void · Not scored</span>} />

    <Anno>6 · Postponed</Anno>
    <CardC left={["🇦🇺", "AUS", "Australia"]} right={["🇹🇷", "TUR", "Türkiye"]}
      over="Postponed"
      cap={<div className="cc-cap"><span className="cc-capscore" style={{ fontSize: 17 }}>→ Jun 14</span></div>}
      foot={<React.Fragment><span className="chip chip--postponed">Postponed</span><span>Pick stays open</span></React.Fragment>} />
  </div>
);

/* ================= TOKENS SPECIMEN ================= */

const Sw = ({ v, l }) => (
  <div className="tk-sw"><div className="box" style={{ background: `var(${v})` }}></div><div className="lbl">{l}</div></div>
);

const TokensBoard = () => (
  <div className="tk">
    <div>
      <h3>Neutrals — cool slate</h3>
      <div className="tk-swatches">
        <Sw v="--color-bg" l="bg" />
        <Sw v="--q-slate-50" l="surface-2" />
        <Sw v="--q-slate-100" l="surface-3" />
        <Sw v="--q-slate-200" l="border" />
        <Sw v="--q-slate-400" l="disabled" />
        <Sw v="--q-slate-500" l="text-3" />
        <Sw v="--q-slate-600" l="text-2" />
        <Sw v="--q-slate-900" l="text / accent" />
      </div>
    </div>
    <div>
      <h3>Semantic — pick outcomes &amp; states</h3>
      <div className="tk-swatches">
        <Sw v="--color-exact" l="exact" />
        <Sw v="--color-exact-soft" l="exact-soft" />
        <Sw v="--color-partial" l="partial" />
        <Sw v="--color-partial-soft" l="partial-soft" />
        <Sw v="--color-live" l="live/urgent" />
        <Sw v="--color-live-soft" l="live-soft" />
      </div>
    </div>
    <div>
      <h3>Points tags (component)</h3>
      <div className="tk-chips">
        <span className="chip chip--exact">Exact · +3</span>
        <span className="chip" style={{ background: "var(--color-partial)", color: "#fff" }}>Outcome · +1</span>
        <span className="chip" style={{ background: "var(--color-partial)", color: "#fff" }}>Draw called · +1</span>
        <span className="chip chip--void">0</span>
        <span className="chip chip--void">— no pick</span>
        <span className="chip chip--void"><Lock /> Locked</span>
        <span className="chip chip--postponed">Postponed</span>
      </div>
    </div>
    <div>
      <h3>Type — system stack, 16px body minimum</h3>
      <div className="tk-typerow"><span className="lbl">display · 40/700</span><span style={{ font: "var(--text-display)", fontVariantNumeric: "tabular-nums" }}>2 – 1</span></div>
      <div className="tk-typerow"><span className="lbl">score · 28/700</span><span style={{ font: "var(--text-score)" }}>3 – 0</span></div>
      <div className="tk-typerow"><span className="lbl">title · 22/700</span><span style={{ font: "var(--text-title)" }}>Partidos</span></div>
      <div className="tk-typerow"><span className="lbl">heading · 17/650</span><span style={{ font: "var(--text-heading)" }}>México vs Sudáfrica</span></div>
      <div className="tk-typerow"><span className="lbl">body · 16/400</span><span style={{ font: "var(--text-body)" }}>Tu pronóstico se guarda solo.</span></div>
      <div className="tk-typerow"><span className="lbl">label · 13/600</span><span style={{ font: "var(--text-label)" }}>GRUPO A · HOY, 13:00</span></div>
    </div>
    <div style={{ font: "var(--text-caption)", color: "var(--color-text-3)" }}>
      Radii 10 / 16 / 22 / 28 / pill · spacing 4-grid · tap targets ≥44px · all scores tabular-nums ·
      accent is a token — a festive theme or team colors swap in without touching components.
    </div>
  </div>
);

/* ================= CANVAS ================= */

const App = () => (
  <DesignCanvas>
    <DCSection id="system" title="System" subtitle="Tokens first — components only reference aliases. Cool slate, ink accent, semantic colors for outcomes.">
      <DCArtboard id="tokens" label="Design tokens v1" width={620} height={780}>
        <TokensBoard />
      </DCArtboard>
      <DCPostIt>
        Assumptions: simulated date = Sat Jun 13 (matchday 3) so every card state appears naturally. Real WC 2026 fixtures. Emoji flags, FIFA codes on cards, full names on detail.
      </DCPostIt>
      <DCPostIt>
        From your reference: soft off-white, big radii, huge tabular numerals, pastel washes, black pill accents — contrast pushed up, recolored to cool slate.
      </DCPostIt>
    </DCSection>

    <DCSection id="directions" title="Match card — 3 directions" subtitle="All 7 states each, same tokens. A = pastel state washes · B = typographic ledger (shown in Spanish, worst-case widths) · C = morphing scoreboard capsule">
      <DCArtboard id="dir-a" label="A · Soft Tiles — state = card wash" width={390} height={1330}>
        <DirectionA />
      </DCArtboard>
      <DCArtboard id="dir-b" label="B · Ink Ledger — typographic, ES" width={390} height={1640}>
        <DirectionB />
      </DCArtboard>
      <DCArtboard id="dir-c" label="C · Scoreboard — capsule morphs per state" width={390} height={1480}>
        <DirectionC />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
