// Reglas de dominio de los avisos (ventana del tablero, filtros, estados).

import type { Notice } from "@/lib/api";
import { getDaysUntilDue } from "@/lib/format";

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

