// Reglas de dominio de los avisos (ventana del tablero, filtros, estados).

import type { Notice, UserRef } from "@/lib/api";
import { formatDate, formatDateTime, getDaysUntilDue } from "@/lib/format";
import { matchesPolicyNumber } from "@/lib/policy-numbers";

export type NoticeStatus = Notice["status"];
export type NoticeView = "kanban" | "list";

export type NoticeFilters = {
  search: string;
  companyId: string;
  branch: string;
  status: "all" | NoticeStatus;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_NOTICE_FILTERS: NoticeFilters = {
  search: "",
  companyId: "all",
  branch: "all",
  status: "all",
  dateFrom: "",
  dateTo: ""
};

export const NOTICE_WINDOW_DAYS = 15;

// Si un asegurado tiene varios vencimientos con 5 días o menos de diferencia
// entre sí, se muestran como un único aviso agrupado (se lo contacta una sola vez).
export const NOTICE_GROUP_GAP_DAYS = 5;

function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T00:00:00`).getTime();
  return Math.abs(Math.round((to - from) / 86400000));
}

// Agrupa los avisos de una columna del kanban: mismo asegurado y vencimientos
// encadenados (cada uno a ≤5 días del anterior). Devuelve clusters ordenados
// por el vencimiento más próximo; un cluster de 1 se renderiza como tarjeta simple.
export function clusterNoticesByClient(notices: Notice[]): Notice[][] {
  const byClient = new Map<string, Notice[]>();
  const clusters: Notice[][] = [];

  for (const notice of notices) {
    const clientId = notice.policies?.clients?.id;
    if (!clientId) {
      clusters.push([notice]);
      continue;
    }
    const list = byClient.get(clientId) ?? [];
    list.push(notice);
    byClient.set(clientId, list);
  }

  for (const list of byClient.values()) {
    list.sort((a, b) => a.due_date.localeCompare(b.due_date));
    let current: Notice[] = [];
    for (const notice of list) {
      const previous = current[current.length - 1];
      if (previous && daysBetween(previous.due_date, notice.due_date) <= NOTICE_GROUP_GAP_DAYS) {
        current.push(notice);
      } else {
        if (current.length > 0) clusters.push(current);
        current = [notice];
      }
    }
    if (current.length > 0) clusters.push(current);
  }

  clusters.sort((a, b) => (a[0]?.due_date ?? "").localeCompare(b[0]?.due_date ?? ""));
  return clusters;
}

// El tablero muestra un aviso recién 15 días antes de su vencimiento (o si ya venció).
// Un aviso pagado se "borra" del tablero una vez que pasaron 15 días de su vencimiento;
// para entonces ya apareció el siguiente aviso generado al pagar.
export function isNoticeInWindow(notice: Notice) {
  const days = getDaysUntilDue(notice.due_date);
  if (days > NOTICE_WINDOW_DAYS) return false;
  if (notice.status === "pagado" && days < -NOTICE_WINDOW_DAYS) return false;
  return true;
}

export function matchesNoticeFilters(notice: Notice, filters: NoticeFilters) {
  const term = filters.search.toLowerCase();
  const client = notice.policies?.clients;
  const policy = notice.policies;
  const company = policy?.insurance_companies;
  const matchesSearch =
    !term ||
    client?.full_name?.toLowerCase().includes(term) ||
    matchesPolicyNumber(policy, term) ||
    policy?.vehicle_plate?.toLowerCase().includes(term);
  const matchesCompany = filters.companyId === "all" || company?.id === filters.companyId;
  const matchesBranch = filters.branch === "all" || policy?.branch === filters.branch;
  const matchesStatus = filters.status === "all" || notice.status === filters.status;
  const matchesFrom = !filters.dateFrom || notice.due_date >= filters.dateFrom;
  const matchesTo = !filters.dateTo || notice.due_date <= filters.dateTo;
  return matchesSearch && matchesCompany && matchesBranch && matchesStatus && matchesFrom && matchesTo;
}


export function countUrgentNotices(notices: Notice[]) {
  return notices.filter((notice) => notice.status !== "pagado" && getDaysUntilDue(notice.due_date) <= 7).length;
}


export function noticeStatusLabel(status: Notice["status"]) {
  if (status === "avisar") return "Avisar";
  if (status === "avisado") return "Avisado";
  return "Pagado";
}

export function noticeStatusPill(status: Notice["status"]) {
  const base = "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase";
  if (status === "avisar") return `${base} bg-amber-50 text-amber-700`;
  if (status === "avisado") return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-emerald-50 text-emerald-700`;
}

// Qué decirle a quien está por actuar sobre un aviso que otra persona ya cambió:
// quién lo hizo y cuándo ("Ya fue avisado por Ana el 10/11/2026, 14:30."). Null si
// el aviso sigue en "avisar", que es el único estado desde el que se avisa.
export function describeNoticeAlreadyHandled(notice: Notice, currentUserId: string | null): string | null {
  if (notice.status === "avisar") return null;
  const paid = notice.status === "pagado";
  const by = paid ? notice.payment_processed_by : notice.notified_by;
  const at = paid ? notice.payment_processed_at : notice.notified_at;
  const who = by ? (by.id === currentUserId ? "vos" : by.full_name) : "otra persona";
  const when = at ? formatDateTime(at) : "";
  return `Ya fue ${paid ? "pagado" : "avisado"} por ${who}${when ? ` el ${when}` : ""}.`;
}

// Teléfono y correo del asegurado listos para mostrar: sin espacios sobrantes y
// sin filas vacías. Null si no tiene ninguno de los dos (no se dibuja el bloque).
export type NoticeContact = { phone: string | null; email: string | null };

export function noticeContactOf(
  client: { phone?: string | null; email?: string | null } | null | undefined
): NoticeContact | null {
  const phone = client?.phone?.trim() || null;
  const email = client?.email?.trim() || null;
  return phone || email ? { phone, email } : null;
}

// Acciones que ofrece un aviso según su estado (flujo estricto: avisar ->
// avisado -> pagado). La tarjeta, el detalle y la lista comparten esta tabla.
export type NoticeActionKind = "notify" | "revert" | "pay";

export function noticeActionsFor(status: NoticeStatus): { kind: NoticeActionKind; label: string }[] {
  if (status === "avisar") return [{ kind: "notify", label: "Marcar avisado" }];
  if (status === "avisado") {
    return [
      { kind: "revert", label: "Volver a avisar" },
      { kind: "pay", label: "Registrar pago" }
    ];
  }
  return [{ kind: "revert", label: "Revertir pago" }];
}

// Avisos que todavía hay que contactar: el botón principal del detalle solo
// aparece mientras quede alguno.
export function pendingNotices(notices: Notice[]): Notice[] {
  return notices.filter((notice) => notice.status === "avisar");
}

// Dropping a card on another board column never moves it by itself: the drop
// only starts the flow below, and the card changes column when the server
// confirms the action.
export type NoticeDropFlow =
  | "notify" // avisar -> avisado, one notice
  | "notify-all" // avisar -> avisado, a card with several notices
  | "revert" // avisado -> avisar
  | "revert-payment" // pagado -> avisado
  | "pay" // avisado -> pagado (payment dialog)
  | "notify-then-pay" // avisar -> pagado: payment dialog, then notify, then pay
  | "open-detail"; // several notices: no bulk payment or revert, act per policy

export type NoticeDropResult = { valid: false } | { valid: true; flow: NoticeDropFlow };

const INVALID_DROP: NoticeDropResult = { valid: false };

export function resolveNoticeDrop(from: NoticeStatus, to: NoticeStatus, noticeCount: number): NoticeDropResult {
  if (noticeCount < 1 || from === to) return INVALID_DROP;
  // Reverting a payment always ends in "avisado": there is no direct way back to "avisar".
  if (from === "pagado" && to === "avisar") return INVALID_DROP;

  if (noticeCount > 1) {
    return { valid: true, flow: from === "avisar" && to === "avisado" ? "notify-all" : "open-detail" };
  }

  if (from === "avisar") return { valid: true, flow: to === "avisado" ? "notify" : "notify-then-pay" };
  if (from === "avisado") return { valid: true, flow: to === "avisar" ? "revert" : "pay" };
  return { valid: true, flow: "revert-payment" };
}

// Cuánto dura el cartel "lo avisó recién" cuando otra persona resolvió el aviso.
export const RECENT_HANDLING_WINDOW_MS = 2 * 60 * 1000;

export type NoticeHandling = { kind: "notified" | "paid"; by: UserRef; at: string; atMs: number };

// Quién resolvió el estado actual del aviso (avisó si está "avisado", cobró si está
// "pagado"). Null si sigue en "avisar" o el dato no viene.
export function noticeHandling(notice: Notice): NoticeHandling | null {
  if (notice.status === "avisar") return null;
  const paid = notice.status === "pagado";
  const by = paid ? notice.payment_processed_by : notice.notified_by;
  const at = paid ? notice.payment_processed_at : notice.notified_at;
  if (!by || !at) return null;
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) return null;
  return { kind: paid ? "paid" : "notified", by, at, atMs };
}

// "Otra persona, hace poco": solo si el usuario actual es conocido y no es quien
// hizo el cambio (nunca se muestra el cartel por la acción propia) y pasaron menos
// de dos minutos. La hora del servidor puede adelantar al reloj local: una edad
// negativa cuenta como reciente y vence igual en `atMs + ventana`.
export function recentHandlingByOther(
  notice: Notice,
  currentUserId: string | null,
  now: number
): NoticeHandling | null {
  if (!currentUserId) return null;
  const handling = noticeHandling(notice);
  if (!handling || handling.by.id === currentUserId) return null;
  return now - handling.atMs < RECENT_HANDLING_WINDOW_MS ? handling : null;
}

// Primer instante futuro en que algún cartel de la lista deja de ser reciente.
export function recentHandlingDeadline(
  notices: Notice[],
  currentUserId: string | null,
  now: number
): number | null {
  let deadline: number | null = null;
  for (const notice of notices) {
    const handling = recentHandlingByOther(notice, currentUserId, now);
    if (!handling) continue;
    const expires = handling.atMs + RECENT_HANDLING_WINDOW_MS;
    if (deadline === null || expires < deadline) deadline = expires;
  }
  return deadline;
}

// "hace unos segundos" / "hace 1 minuto" / "hace 2 minutos".
export function describeHandlingAge(atMs: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - atMs) / 60000);
  if (minutes < 1) return "hace unos segundos";
  return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

// "hoy 15:29", "ayer 16:20", "09/11 11:05" (con año si no es el actual).
export function formatHandlingWhen(iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date(now);
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((dayStart(today) - dayStart(at)) / 86400000);
  if (dayDiff === 0) return `hoy ${time}`;
  if (dayDiff === 1) return `ayer ${time}`;
  const date = `${pad2(at.getDate())}/${pad2(at.getMonth() + 1)}`;
  return `${at.getFullYear() === today.getFullYear() ? date : `${date}/${at.getFullYear()}`} ${time}`;
}

// Línea de auditoría de la tarjeta y del detalle: "Avisado por Ana · ayer 16:20".
export function describeNoticeHandlingLine(
  notice: Notice,
  currentUserId: string | null,
  now: number
): { kind: "notified" | "paid"; text: string } | null {
  const handling = noticeHandling(notice);
  if (!handling) return null;
  const who = handling.by.id === currentUserId ? "vos" : handling.by.full_name;
  const when = formatHandlingWhen(handling.at, now);
  const lead = handling.kind === "paid" ? "Pago registrado por" : "Avisado por";
  return { kind: handling.kind, text: `${lead} ${who}${when ? ` · ${when}` : ""}` };
}

// Cómo se nombra el seguro en el mensaje al cliente, según la rama.
// Para vehículos se incluye la patente si está cargada.
function policyPhrases(policy: Notice["policies"]) {
  const branch = (policy?.branch ?? "").trim();
  const normalized = branch
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const plate = policy?.vehicle_plate ? ` patente ${policy.vehicle_plate}` : "";
  const number = policy?.policy_number ? ` N° ${policy.policy_number}` : "";

  if (normalized.includes("automotor") || normalized.includes("auto")) {
    return { inline: `el pago del seguro de su *vehículo${plate}*`, bullet: `Seguro del vehículo${plate}` };
  }
  if (normalized.includes("moto")) {
    return { inline: `el pago del seguro de su *moto${plate}*`, bullet: `Seguro de la moto${plate}` };
  }
  if (normalized.includes("hogar") || normalized.includes("vivienda")) {
    return { inline: "el pago del seguro de su *vivienda*", bullet: "Seguro del hogar" };
  }
  if (normalized.includes("comercio")) {
    return { inline: "el pago del seguro de su *comercio*", bullet: "Seguro del comercio" };
  }
  if (normalized.includes("vida")) {
    return { inline: "el pago de su *seguro de vida*", bullet: "Seguro de vida" };
  }
  if (normalized.includes("accidentes")) {
    return {
      inline: "el pago de su *seguro de accidentes personales*",
      bullet: "Seguro de accidentes personales"
    };
  }
  if (normalized.includes("responsabilidad")) {
    return {
      inline: "el pago de su *seguro de responsabilidad civil*",
      bullet: "Seguro de responsabilidad civil"
    };
  }
  const generic = branch ? `póliza de ${branch}${number}` : `póliza${number}`;
  return { inline: `el pago de su *${generic}*`, bullet: capitalizeWords(generic) };
}

function capitalizeWords(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Mensaje listo para copiar y mandar por WhatsApp al avisar un vencimiento.
// Con varios avisos del mismo asegurado arma una lista; con uno solo, la
// oración completa adaptada al tipo de seguro (vehículo con patente, etc.).
export function buildNoticeReminderMessage(notices: Notice[]): string {
  const first = notices[0];
  if (!first) return "";
  const clientName = first.policies?.clients?.full_name?.trim();
  const greetingName = clientName || "cliente";

  const intro =
    notices.length === 1
      ? `Le escribimos para recordarle que ${policyPhrases(first.policies).inline} tiene como fecha de vencimiento el día *${formatDate(first.due_date)}*.`
      : [
          "Le escribimos para recordarle los próximos vencimientos de sus seguros:",
          "",
          ...notices.map(
            (notice) => `- *${policyPhrases(notice.policies).bullet}*: vence el día *${formatDate(notice.due_date)}*.`
          )
        ].join("\n");

  return [
    `*Estimado/a ${greetingName}, esperamos que se encuentre muy bien.* ℹ️`,
    "",
    intro,
    "",
    "*💳 Métodos de pago disponibles:*",
    "",
    "- *Efectivo:* En nuestras oficinas.",
    "- *Link de Mercado Pago:* ",
    "",
    "*⚠️ Importante:*",
    "Le recordamos que la falta de pago en término puede ocasionar la suspensión de su cobertura.",
    "",
    "Quedamos a su disposición ante cualquier consulta.",
    "",
    "¡Que tenga un excelente día! ✅",
    "",
    "*Saludos cordiales.*"
  ].join("\n");
}

