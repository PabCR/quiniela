/* Quiniela — ES/EN string dictionary, typed.
 *
 * Ported as-is from prototype/app/i18n.js (both languages), plus:
 *  - KO stage labels added per brief §6.3 (stageR32/R16/QF/SF/THIRD/FINAL).
 *    A distinct `stageFinal` key is used because a `final` key already exists
 *    for the match-final status string.
 *  - Auth-flow + native-app keys (brief §7) the web prototype lacked.
 *
 * Pure module: no RN/Expo imports. `makeT(lang)` returns a translator with
 * `{var}` interpolation that falls back es → en → key.
 */

import type { Lang } from './types';

/* Interpolation variables passed to the translator. */
export type Vars = Record<string, string | number>;

/* English is the canonical key set; Spanish must mirror it (enforced below). */
export const en = {
  /* ---- tabs ---- */
  tabMatches: 'Matches',
  tabBoard: 'Leaderboard',
  tabMe: 'Me',

  /* ---- pending picks ---- */
  pending_one: '1 pick pending',
  pending_other: '{n} picks pending',
  pendingNone: 'All picked ✓',

  /* ---- date groups ---- */
  today: 'Today',
  tomorrow: 'Tomorrow',

  /* ---- stage labels ---- */
  group: 'Group {g}',
  r32: 'Round of 32',
  /* KO stage labels (brief §6.3). `stageR32` kept alongside `r32` for parity. */
  stageR32: 'Round of 32',
  stageR16: 'Round of 16',
  stageQF: 'Quarter-final',
  stageSF: 'Semi-final',
  stageThird: 'Third place',
  stageFinal: 'Final',

  /* ---- filters ---- */
  filterAll: 'All',
  filterPending: 'My pending',

  /* ---- card / pick states ---- */
  makePick: 'Make your pick',
  closesIn: 'Closes in {t}',
  closesAt: 'Closes {t}',
  yourPick: 'Your pick',
  edit: 'Edit',
  tapToEdit: 'Tap to edit',
  live: 'Live',
  lockedNote: 'Your pick is locked',
  awaitingResult: 'Awaiting result',
  final: 'Final',
  youPicked: 'You picked {s}',
  voidTag: 'Void · Not scored',
  played: 'Played {d}',
  postponed: 'Postponed',
  newDate: 'New date · {d}',
  pickOpen: 'Pick stays open',

  /* ---- tags / points ---- */
  tagExact: 'Exact',
  tagOutcome: 'Outcome',
  tagDraw: 'Draw called',
  tagNoPick: '—',
  ptsPlus: '+{n}',
  pts: '{n} pts',

  /* ---- match detail ---- */
  detailTitle: 'Match',
  kickoff: 'Kickoff {t}',
  saved: 'Saved',
  saving: 'Saving…',
  whoAdvances: 'Who advances on penalties?',
  advNeeded: 'Pick who advances to complete your prediction',
  havePicked: '{n}/{m} have picked',
  picksHidden: 'Picks are revealed at kickoff',
  everyonesPicks: "Everyone's picks",
  resultRow: 'Result',
  corrected: 'Result corrected by admin',
  advances: '{team} advances',

  /* ---- leaderboard ---- */
  boardEmptyTitle: 'Everyone starts at zero',
  boardEmptyBody: 'Points appear after the first final result. Get your picks in!',
  exactShort: 'exact',
  youChip: 'You',

  /* ---- profile / me ---- */
  profileStats: 'Stats',
  profileHistory: 'Pick history',
  statPoints: 'Points',
  statExact: 'Exact scores',
  statRank: 'Position',
  meLanguage: 'Language',
  meAvatar: 'Tap to change your avatar',
  meAdmin: 'Admin',
  meResults: 'Results entry',
  meMembers: 'Members',
  meHistory: 'My picks',

  /* ---- join (prototype name-grid; kept for reference) ---- */
  joinTitle: 'Who are you?',
  joinSub: "Pablo's family World Cup pool · tap your name",
  joinAvatarTitle: 'Pick your avatar',
  joinAvatarSub: 'You can change it later',
  joinGo: "Let's go",
  joinClaimedTitle: 'All names are claimed',
  joinClaimedBody: 'Ask Pablo to add you to the pool.',
  joinInvalidTitle: 'This link has expired',
  joinInvalidBody: 'Ask Pablo for a new invite link.',
  skip: 'Skip',

  /* ---- admin: results ---- */
  adminAwaiting: 'Awaiting result',
  adminEntered: 'Entered',
  adminNoAwaiting: 'Nothing to score — all caught up.',
  enterResult: 'Enter result',
  saveResult: 'Save result',
  confirmTitle: 'Confirm result',
  confirmBody: 'This awards:',
  impExact: '{n} exact',
  impOutcome: '{n} outcome',
  impDraw: '{n} draw called',
  impMiss: '{n} miss',
  impNone: '{n} no pick',
  cancel: 'Cancel',
  confirm: 'Confirm',
  close: 'Close',
  markVoid: 'Mark match void',
  voidBody: "No points will be awarded for this match. You can't undo this in the prototype.",
  editResult: 'Edit',
  editedTag: 'corrected',

  /* ---- admin: members (prototype invite-link; superseded below) ---- */
  inviteLink: 'Invite link',
  copy: 'Copy',
  copied: 'Copied ✓',
  regen: 'Regenerate',
  addName: 'Add name',
  claimed: 'Claimed',
  unclaimed: 'Unclaimed',
  release: 'Release',
  releaseBody: '{name} will be able to be claimed again from the invite link.',
  a2hsTitle: 'Pick saved — nice!',
  a2hsBody: 'Add Quiniela to your home screen to check scores in one tap.',
  a2hsCta: 'Got it',
  back: 'Back',

  /* ============================================================ *
   * Native-app additions (brief §7) — not present in prototype.
   * ============================================================ */

  /* ---- auth: invite code screen ("the key to the house") ---- */
  inviteTitle: 'The key to the house',
  inviteSub: 'Enter the invite code to join the family pool.',
  inviteCodeLabel: 'Invite code',
  inviteCodePlaceholder: 'Enter code',
  inviteContinue: 'Continue',
  inviteErrorWrong: 'Ask Pablo for the code',
  inviteErrorEmpty: 'Enter the invite code',

  /* ---- auth: email entry ---- */
  emailTitle: "What's your email?",
  emailSub: "We'll send you a 6-digit code to sign in.",
  emailLabel: 'Email',
  emailPlaceholder: 'you@email.com',
  emailContinue: 'Send code',
  emailErrorInvalid: 'Enter a valid email',
  emailSending: 'Sending…',

  /* ---- auth: OTP code screen ---- */
  otpTitle: 'Enter your code',
  otpSub: 'We sent a 6-digit code to {email}.',
  otpLabel: 'Code',
  otpPlaceholder: '123456',
  otpContinue: 'Verify',
  otpVerifying: 'Verifying…',
  otpResend: 'Resend code',
  otpResendIn: 'Resend in {t}',
  otpErrorWrong: 'That code is wrong or expired. Try again.',
  otpErrorExpired: 'Code expired — request a new one.',
  otpChangeEmail: 'Use a different email',

  /* ---- auth: profile setup ---- */
  profileSetupTitle: "What's your name?",
  profileSetupSub: 'This is how the family sees you on the board.',
  profileNameLabel: 'Display name',
  profileNamePlaceholder: 'Your name',
  profileNameTaken: 'That name is taken. Try "{suggestion}".',
  profileNameEmpty: 'Enter a display name',
  profileSubmit: "Join the pool",
  profileJoining: 'Joining…',

  /* ---- session / sign out ---- */
  signOut: 'Sign out',
  signOutConfirm: 'Sign out of Quiniela?',
  signOutBody: "You'll need your code to sign back in.",

  /* ---- admin: members (new native screen) ---- */
  inviteCode: 'Invite code',
  rotateCode: 'Rotate',
  rotateConfirm: 'Rotate the invite code?',
  rotateBody: 'The old code stops working. Share the new one with anyone still joining.',
  memberAdd: 'Add member',
  memberHide: 'Hide',
  memberUnhide: 'Unhide',
  memberHidden: 'Hidden',
  membersTitle: 'Members',
  membersCount: '{n} members',

  /* ---- admin: provisional marker ---- */
  provisional: 'Provisional',
  provisionalNote: 'Auto-synced result — confirm to score it.',
} as const;

/** Translation keys (union of every dictionary key). */
export type TKey = keyof typeof en;

/** A full language table. Spanish must supply every English key. */
export type Dict = Record<TKey, string>;

export const es: Dict = {
  /* ---- tabs ---- */
  tabMatches: 'Partidos',
  tabBoard: 'Tabla',
  tabMe: 'Yo',

  /* ---- pending picks ---- */
  pending_one: '1 pronóstico pendiente',
  pending_other: '{n} pronósticos pendientes',
  pendingNone: 'Todo listo ✓',

  /* ---- date groups ---- */
  today: 'Hoy',
  tomorrow: 'Mañana',

  /* ---- stage labels ---- */
  group: 'Grupo {g}',
  r32: 'Dieciseisavos',
  stageR32: 'Dieciseisavos',
  stageR16: 'Octavos',
  stageQF: 'Cuartos',
  stageSF: 'Semifinal',
  stageThird: 'Tercer lugar',
  stageFinal: 'Final',

  /* ---- filters ---- */
  filterAll: 'Todos',
  filterPending: 'Mis pendientes',

  /* ---- card / pick states ---- */
  makePick: 'Haz tu pronóstico',
  closesIn: 'Cierra en {t}',
  closesAt: 'Cierra {t}',
  yourPick: 'Tu pronóstico',
  edit: 'Editar',
  tapToEdit: 'Toca para editar',
  live: 'En vivo',
  lockedNote: 'Tu pronóstico está bloqueado',
  awaitingResult: 'Esperando resultado',
  final: 'Final',
  youPicked: 'Pronosticaste {s}',
  voidTag: 'Anulado · No puntúa',
  played: 'Jugado {d}',
  postponed: 'Aplazado',
  newDate: 'Nueva fecha · {d}',
  pickOpen: 'Aún puedes pronosticar',

  /* ---- tags / points ---- */
  tagExact: 'Exacto',
  tagOutcome: 'Acierto',
  tagDraw: 'Empate acertado',
  tagNoPick: '—',
  ptsPlus: '+{n}',
  pts: '{n} pts',

  /* ---- match detail ---- */
  detailTitle: 'Partido',
  kickoff: 'Inicio {t}',
  saved: 'Guardado',
  saving: 'Guardando…',
  whoAdvances: '¿Quién avanza en penales?',
  advNeeded: 'Elige quién avanza para completar tu pronóstico',
  havePicked: '{n}/{m} ya pronosticaron',
  picksHidden: 'Los pronósticos se revelan al inicio',
  everyonesPicks: 'Pronósticos de todos',
  resultRow: 'Resultado',
  corrected: 'Resultado corregido por el admin',
  advances: 'Avanza {team}',

  /* ---- leaderboard ---- */
  boardEmptyTitle: 'Todos empiezan en cero',
  boardEmptyBody: 'Los puntos aparecen con el primer resultado. ¡Haz tus pronósticos!',
  exactShort: 'exactos',
  youChip: 'Tú',

  /* ---- profile / me ---- */
  profileStats: 'Estadísticas',
  profileHistory: 'Historial',
  statPoints: 'Puntos',
  statExact: 'Marcadores exactos',
  statRank: 'Posición',
  meLanguage: 'Idioma',
  meAvatar: 'Toca para cambiar tu avatar',
  meAdmin: 'Admin',
  meResults: 'Capturar resultados',
  meMembers: 'Miembros',
  meHistory: 'Mis pronósticos',

  /* ---- join ---- */
  joinTitle: '¿Quién eres?',
  joinSub: 'Quiniela familiar del Mundial · toca tu nombre',
  joinAvatarTitle: 'Elige tu avatar',
  joinAvatarSub: 'Puedes cambiarlo después',
  joinGo: 'Vamos',
  joinClaimedTitle: 'Todos los nombres están tomados',
  joinClaimedBody: 'Pídele a Pablo que te agregue a la quiniela.',
  joinInvalidTitle: 'Este enlace ya no sirve',
  joinInvalidBody: 'Pídele a Pablo un enlace nuevo.',
  skip: 'Omitir',

  /* ---- admin: results ---- */
  adminAwaiting: 'Esperando resultado',
  adminEntered: 'Capturados',
  adminNoAwaiting: 'Nada por capturar — todo al día.',
  enterResult: 'Capturar resultado',
  saveResult: 'Guardar resultado',
  confirmTitle: 'Confirmar resultado',
  confirmBody: 'Esto otorga:',
  impExact: '{n} exactos',
  impOutcome: '{n} aciertos',
  impDraw: '{n} empates acertados',
  impMiss: '{n} fallos',
  impNone: '{n} sin pronóstico',
  cancel: 'Cancelar',
  confirm: 'Confirmar',
  close: 'Cerrar',
  markVoid: 'Anular partido',
  voidBody: 'No se otorgarán puntos por este partido. No se puede deshacer en el prototipo.',
  editResult: 'Editar',
  editedTag: 'corregido',

  /* ---- admin: members (prototype invite-link) ---- */
  inviteLink: 'Enlace de invitación',
  copy: 'Copiar',
  copied: 'Copiado ✓',
  regen: 'Regenerar',
  addName: 'Agregar nombre',
  claimed: 'Tomado',
  unclaimed: 'Libre',
  release: 'Liberar',
  releaseBody: '{name} podrá reclamarse de nuevo desde el enlace de invitación.',
  a2hsTitle: 'Pronóstico guardado — ¡bien!',
  a2hsBody: 'Agrega Quiniela a tu pantalla de inicio para verla de un toque.',
  a2hsCta: 'Entendido',
  back: 'Atrás',

  /* ============================================================ *
   * Native-app additions (brief §7)
   * ============================================================ */

  /* ---- auth: invite code screen ---- */
  inviteTitle: 'La llave de la casa',
  inviteSub: 'Escribe el código de invitación para entrar a la quiniela familiar.',
  inviteCodeLabel: 'Código de invitación',
  inviteCodePlaceholder: 'Escribe el código',
  inviteContinue: 'Continuar',
  inviteErrorWrong: 'Pídele el código a Pablo',
  inviteErrorEmpty: 'Escribe el código de invitación',

  /* ---- auth: email entry ---- */
  emailTitle: '¿Cuál es tu correo?',
  emailSub: 'Te enviaremos un código de 6 dígitos para entrar.',
  emailLabel: 'Correo',
  emailPlaceholder: 'tu@correo.com',
  emailContinue: 'Enviar código',
  emailErrorInvalid: 'Escribe un correo válido',
  emailSending: 'Enviando…',

  /* ---- auth: OTP code screen ---- */
  otpTitle: 'Escribe tu código',
  otpSub: 'Enviamos un código de 6 dígitos a {email}.',
  otpLabel: 'Código',
  otpPlaceholder: '123456',
  otpContinue: 'Verificar',
  otpVerifying: 'Verificando…',
  otpResend: 'Reenviar código',
  otpResendIn: 'Reenviar en {t}',
  otpErrorWrong: 'El código es incorrecto o expiró. Inténtalo de nuevo.',
  otpErrorExpired: 'El código expiró — pide uno nuevo.',
  otpChangeEmail: 'Usar otro correo',

  /* ---- auth: profile setup ---- */
  profileSetupTitle: '¿Cómo te llamas?',
  profileSetupSub: 'Así te ve la familia en la tabla.',
  profileNameLabel: 'Nombre',
  profileNamePlaceholder: 'Tu nombre',
  profileNameTaken: 'Ese nombre ya está tomado. Prueba con "{suggestion}".',
  profileNameEmpty: 'Escribe un nombre',
  profileSubmit: 'Entrar a la quiniela',
  profileJoining: 'Entrando…',

  /* ---- session / sign out ---- */
  signOut: 'Cerrar sesión',
  signOutConfirm: '¿Cerrar sesión de Quiniela?',
  signOutBody: 'Necesitarás tu código para volver a entrar.',

  /* ---- admin: members (new native screen) ---- */
  inviteCode: 'Código de invitación',
  rotateCode: 'Cambiar',
  rotateConfirm: '¿Cambiar el código de invitación?',
  rotateBody: 'El código anterior deja de funcionar. Comparte el nuevo con quien falte por entrar.',
  memberAdd: 'Agregar miembro',
  memberHide: 'Ocultar',
  memberUnhide: 'Mostrar',
  memberHidden: 'Oculto',
  membersTitle: 'Miembros',
  membersCount: '{n} miembros',

  /* ---- admin: provisional marker ---- */
  provisional: 'Provisional',
  provisionalNote: 'Resultado sincronizado — confírmalo para puntuar.',
};

/** Full dictionary keyed by language. */
export const I18N: Record<Lang, Dict> = { en, es };

/** A translator: looks up `key`, interpolates `{var}` tokens. */
export type Translate = (key: TKey, vars?: Vars) => string;

/**
 * Build a translator for `lang`.
 * Fallback order: requested language → English → the key itself.
 * Mirrors the prototype's `makeT` interpolation (`{var}` token replacement).
 */
export function makeT(lang: Lang): Translate {
  const d = I18N[lang] ?? I18N.en;
  return (key: TKey, vars?: Vars): string => {
    let s: string = d[key] ?? en[key] ?? key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      }
    }
    return s;
  };
}
