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
  const base = "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase";
  if (status === "avisar") return `${base} bg-amber-50 text-amber-700`;
  if (status === "avisado") return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-emerald-50 text-emerald-700`;
}

