// Tipos y constantes compartidos entre el shell y las vistas.

import type { Client, InsuranceCompany, OrganizationSettings } from "@/lib/api";

export type Tab = "dashboard" | "notices" | "clients" | "policies" | "companies" | "team" | "settings" | "profile";

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
