// Reglas de dominio de los avisos (ventana del tablero, filtros, estados).

import type { Notice } from "@/lib/api";
import { formatDate, getDaysUntilDue } from "@/lib/format";

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
    policy?.policy_number?.toLowerCase().includes(term) ||
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
    "- *Mercado Pago:* Responda a este mensaje solicitando el link de pago y se lo enviaremos a la brevedad.",
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

