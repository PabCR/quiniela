/* Quiniela — prototype dataset. Simulated clock: Sat 13 Jun 2026, 16:36 local. */

window.Q_NOW = new Date(2026, 5, 13, 16, 36);

window.Q_TEAMS = {
  MEX: { flag: "🇲🇽", en: "Mexico", es: "México" },
  RSA: { flag: "🇿🇦", en: "South Africa", es: "Sudáfrica" },
  KOR: { flag: "🇰🇷", en: "South Korea", es: "Corea del Sur" },
  CZE: { flag: "🇨🇿", en: "Czechia", es: "Chequia" },
  CAN: { flag: "🇨🇦", en: "Canada", es: "Canadá" },
  BIH: { flag: "🇧🇦", en: "Bosnia & Herzegovina", es: "Bosnia y Herzegovina" },
  USA: { flag: "🇺🇸", en: "United States", es: "Estados Unidos" },
  PAR: { flag: "🇵🇾", en: "Paraguay", es: "Paraguay" },
  QAT: { flag: "🇶🇦", en: "Qatar", es: "Catar" },
  SUI: { flag: "🇨🇭", en: "Switzerland", es: "Suiza" },
  BRA: { flag: "🇧🇷", en: "Brazil", es: "Brasil" },
  MAR: { flag: "🇲🇦", en: "Morocco", es: "Marruecos" },
  HAI: { flag: "🇭🇹", en: "Haiti", es: "Haití" },
  SCO: { flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", en: "Scotland", es: "Escocia" },
  GER: { flag: "🇩🇪", en: "Germany", es: "Alemania" },
  CUW: { flag: "🇨🇼", en: "Curaçao", es: "Curazao" },
  CIV: { flag: "🇨🇮", en: "Ivory Coast", es: "Costa de Marfil" },
  ECU: { flag: "🇪🇨", en: "Ecuador", es: "Ecuador" },
  AUS: { flag: "🇦🇺", en: "Australia", es: "Australia" },
  TUR: { flag: "🇹🇷", en: "Türkiye", es: "Turquía" },
};

const D = (day, h, m) => new Date(2026, 5, day, h, m || 0);

/* Real WC 2026 fixtures (kickoffs adapted to device-local demo times).
   ko = kickoff. result set => final. voided => void. newKo => postponed. */
window.Q_MATCHES = [
  { id: "m1", stage: "A", home: "MEX", away: "RSA", ko: D(11, 13, 0), result: { h: 2, a: 1 } },
  { id: "m2", stage: "A", home: "KOR", away: "CZE", ko: D(11, 22, 0), voided: true },
  { id: "m3", stage: "B", home: "CAN", away: "BIH", ko: D(12, 15, 0), result: { h: 1, a: 1 } },
  { id: "m4", stage: "D", home: "USA", away: "PAR", ko: D(12, 21, 0) },                     /* finished by clock, unscored */
  { id: "m5", stage: "B", home: "QAT", away: "SUI", ko: D(13, 15, 30) },                    /* live ~66' */
  { id: "m6", stage: "C", home: "BRA", away: "MAR", ko: D(13, 18, 0) },                     /* <2h, no pick */
  { id: "m7", stage: "C", home: "HAI", away: "SCO", ko: D(13, 21, 0) },                     /* picked */
  { id: "m8", stage: "E", home: "GER", away: "CUW", ko: D(14, 12, 0) },
  { id: "m10", stage: "D", home: "AUS", away: "TUR", ko: D(14, 21, 0), origKo: D(13, 21, 0), postponed: true },
  { id: "m9", stage: "E", home: "CIV", away: "ECU", ko: D(14, 19, 0) },
  { id: "m11", stage: "KO", home: "MEX", away: "SCO", ko: D(28, 15, 0) },                   /* R32 — demo the advancer */
];

/* 16 family members. me = claimed via Join (prototype defaults to Pablo, the admin). */
window.Q_MEMBERS = [
  { id: "pablo",   name: "Pablo",       emoji: "🦊", admin: true, claimed: false },
  { id: "carmen",  name: "Tía Carmen",  emoji: "🌺", claimed: true },
  { id: "jose",    name: "Abuelo José", emoji: "🎩", claimed: true },
  { id: "lupita",  name: "Lupita",      emoji: "🐱", claimed: true },
  { id: "diego",   name: "Diego",       emoji: "⚽", claimed: true },
  { id: "mariana", name: "Mariana",     emoji: "🦋", claimed: true },
  { id: "raul",    name: "Tío Raúl",    emoji: "🌮", claimed: true },
  { id: "sofia",   name: "Sofía",       emoji: "🌟", claimed: true },
  { id: "andres",  name: "Andrés",      emoji: "🎸", claimed: true },
  { id: "vale",    name: "Valentina",   emoji: "🍓", claimed: true },
  { id: "memo",    name: "Memo",        emoji: "🐻", claimed: true },
  { id: "paola",   name: "Paola",       emoji: "🎨", claimed: true },
  { id: "rodrigo", name: "Rodrigo",     emoji: "🚴", claimed: true },
  { id: "camila",  name: "Camila",      emoji: "🌙", claimed: true },
  { id: "beto",    name: "Beto",        emoji: "🥑", claimed: false },
  { id: "ximena",  name: "Ximena",      emoji: "🌵", claimed: false },
];

/* Seeded picks: Q_PICKS[matchId][memberId] = {h, a, adv?}  (adv only for KO draws) */
const P = (rows) => {
  const o = {};
  rows.forEach(([id, h, a, adv]) => { o[id] = adv ? { h, a, adv } : { h, a }; });
  return o;
};

window.Q_PICKS = {
  /* MEX 2-1 RSA → exact: pablo, carmen · outcome: home-win pickers */
  m1: P([["pablo", 2, 1], ["carmen", 2, 1], ["jose", 1, 0], ["lupita", 3, 1], ["diego", 2, 0],
         ["mariana", 1, 1], ["raul", 2, 1], ["sofia", 0, 1], ["andres", 1, 0], ["vale", 2, 2],
         ["memo", 1, 0], ["paola", 3, 0], ["rodrigo", 1, 2], ["camila", 1, 0]]),
  /* CAN 1-1 BIH → exact: carmen, diego · draw callers +1 */
  m3: P([["pablo", 2, 1], ["carmen", 1, 1], ["jose", 1, 1], ["lupita", 0, 0], ["diego", 1, 1],
         ["mariana", 2, 0], ["raul", 1, 0], ["sofia", 1, 1], ["andres", 0, 1], ["vale", 1, 0],
         ["memo", 2, 2], ["paola", 1, 0], ["rodrigo", 0, 0], ["camila", 2, 1]]),
  /* USA-PAR — finished, awaiting admin result */
  m4: P([["pablo", 2, 0], ["carmen", 1, 0], ["jose", 2, 1], ["lupita", 1, 1], ["diego", 3, 1],
         ["mariana", 2, 0], ["raul", 1, 0], ["sofia", 2, 2], ["andres", 1, 0], ["vale", 0, 0],
         ["memo", 2, 1], ["paola", 1, 2], ["rodrigo", 2, 0]]),
  /* QAT-SUI — live, locked */
  m5: P([["pablo", 0, 2], ["carmen", 0, 1], ["jose", 1, 2], ["lupita", 0, 2], ["diego", 1, 1],
         ["mariana", 0, 3], ["raul", 2, 1], ["sofia", 0, 1], ["andres", 1, 3], ["vale", 0, 0],
         ["memo", 1, 1], ["paola", 0, 2], ["rodrigo", 1, 0], ["camila", 0, 1]]),
  /* BRA-MAR — pre-lock: 9 others have picked (hidden), I haven't */
  m6: P([["carmen", 3, 0], ["jose", 2, 0], ["lupita", 2, 1], ["diego", 4, 1], ["mariana", 2, 0],
         ["raul", 3, 1], ["sofia", 1, 0], ["andres", 2, 2], ["vale", 2, 0]]),
  /* HAI-SCO — pre-lock, I picked 1-2 */
  m7: P([["pablo", 1, 2], ["carmen", 0, 1], ["jose", 1, 1], ["diego", 0, 2], ["raul", 1, 3],
         ["sofia", 0, 1], ["memo", 1, 2], ["paola", 0, 0]]),
  m8: P([["carmen", 2, 0], ["diego", 3, 0], ["raul", 4, 0], ["mariana", 2, 1]]),
  m9: P([["pablo", 2, 1], ["carmen", 1, 1], ["jose", 0, 1], ["diego", 2, 2]]),
  m10: P([["carmen", 1, 1], ["diego", 2, 1]]),
  m11: P([["carmen", 1, 1, "MEX"], ["diego", 2, 1], ["raul", 0, 0, "SCO"]]),
};

/* Avatar choices for Join + Me */
window.Q_EMOJIS = ["🦊", "🌺", "🎩", "🐱", "⚽", "🦋", "🌮", "🌟", "🎸", "🍓", "🐻", "🎨", "🚴", "🌙", "🥑", "🌵", "🐢", "🦜", "🍋", "🎺", "🐙", "🌶️"];
