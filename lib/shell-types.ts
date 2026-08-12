// Tipos y constantes compartidos entre el shell y las vistas.

import type { Client, InsuranceCompany, OrganizationSettings, PaymentMethod } from "@/lib/api";

export type Tab = "dashboard" | "notices" | "tasks" | "clients" | "policies" | "companies" | "clubplaza" | "team" | "settings" | "profile";

export const TAB_PATHS = {
  dashboard: "/dashboard",
  notices: "/avisos",
  tasks: "/tareas",
  clients: "/asegurados",
  policies: "/polizas",
  companies: "/companias",
  clubplaza: "/clubplaza",
  team: "/equipo",
  settings: "/configuracion",
  profile: "/perfil"
} as const satisfies Record<Tab, `/${string}`>;

const TAB_BY_PATH = new Map<string, Tab>(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab])
);

export function getTabFromPathname(pathname: string): Tab | null {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalizedPath === "/") return "dashboard";
  return TAB_BY_PATH.get(normalizedPath) ?? null;
}

export type NoticeNoteApi = {
  currentUserId: string;
  busyNoticeId: string | null;
  deletingNoteId: string | null;
  onAdd: (noticeId: string, note: string) => Promise<void>;
  onDelete: (noticeId: string, noteId: string) => Promise<void>;
};

export type PolicyFormValues = {
  clientId: string;
  insuranceCompanyId: string;
  branch: string;
  policyNumber: string;
  vehiclePlate: string;
  paymentIntervalMonths: number;
  paymentMethod: PaymentMethod;
  firstPaymentDate: string;
};

export type PolicyActions = {
  clients: Client[];
  companies: InsuranceCompany[];
  isSaving: boolean;
  isDeleting: boolean;
  onUpdate: (policyId: string, values: PolicyFormValues) => Promise<unknown>;
  onDelete: (policyId: string) => Promise<unknown>;
};
export type EntityView = "grid" | "list";

export type UpdateOrganizationPayload = {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
};

export type UploadLogoPayload = {
  file: File;
  kind: "main" | "login";
};

export type UploadLogoResponse = {
  url: string;
  organization?: OrganizationSettings;
};

export const BRANCHES = [
  "Automotores",
  "Motovehiculos",
  "Responsabilidad civil",
  "Hogar",
  "Comercio",
  "Vida",
  "Accidentes Personales",
  "Otro"
];
