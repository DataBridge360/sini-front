// Integración con Club Plaza: contrato de la carga masiva de jugadores y
// cliente HTTP. Las llamadas van al proxy same-origin (/api/clubplaza/...),
// que valida la sesión de SiniPro y agrega las credenciales del productor de
// Club Plaza del lado del servidor (nunca viajan al navegador).

import { authStorage } from "@/lib/api";

// ----- Contrato del preview (POST /bulk-import/preview de Club Plaza) -----

export type NewPlayer = {
  row: number;
  dni: string;
  nombre: string;
  apellido: string;
  nombre_completo: string;
  fecha_nacimiento: string;
  status: "new";
};

export type ExistingPlayer = {
  row: number;
  dni: string;
  nombre_completo: string;
  existing_id: string;
  message: string;
};

export type DniConflict = {
  row: number;
  dni: string;
  nombre_nuevo: string;
  nombre_existente: string;
  existing_id: string;
  message: string;
};

export type BirthDateConflict = {
  row: number;
  dni: string;
  nombre_completo: string;
  fecha_nacimiento_nueva: string;
  fecha_nacimiento_existente: string;
  existing_id: string;
  message: string;
};

export type NameConflict = {
  row: number;
  dni_nuevo: string;
  dni_existente: string;
  nombre_completo: string;
  existing_id: string;
  message: string;
};

export type DniChangedConflict = {
  row: number;
  nombre_completo: string;
  dni_nuevo: string;
  dni_existente: string;
  fecha_nacimiento: string;
  existing_id: string;
  message: string;
};

export type NameChangedConflict = {
  row: number;
  dni: string;
  nombre_nuevo: string;
  nombre_existente: string;
  fecha_nacimiento: string;
  existing_id: string;
  message: string;
};

export type PagadoToUpdate = {
  row: number;
  dni: string;
  nombre_completo: string;
  existing_id: string;
};

export type PreviewErrorItem = {
  row: number;
  dni: string | null;
  message: string;
};

export type PreviewResponse = {
  total: number;
  new_players: NewPlayer[];
  existing_players: ExistingPlayer[];
  dni_conflicts: DniConflict[];
  birth_date_conflicts: BirthDateConflict[];
  name_conflicts: NameConflict[];
  dni_changed_players: DniChangedConflict[];
  name_changed_players: NameChangedConflict[];
  pagado_to_update: PagadoToUpdate[];
  errors: PreviewErrorItem[];
  // Referencia al Excel ya parseado en memoria de Club Plaza; expira a los 15 min.
  preview_token: string;
};

// ----- Contrato del confirm (via proxy; productor_id y club_id los inyecta el server) -----

export type ConfirmRequest = {
  preview_token: string;
  overwrite_existing: boolean;
  accepted_conflict_ids: string[];
  test_mode?: boolean;
};

export type CreatedPlayer = {
  dni: string;
  nombre: string;
  apellido: string;
  nombre_completo: string;
  fecha_nacimiento: string;
  row: number;
};

export type ImportError = {
  row: number;
  dni: string;
  error: string;
};

export type ImportResult = {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  created_players: CreatedPlayer[];
  updated_players: CreatedPlayer[];
  errors: ImportError[];
  summary: {
    jugadores_created: number;
    jugador_club_created: number;
  };
  message: string;
};

// ----- Cliente HTTP hacia el proxy -----

async function clubplazaProxyFetch(path: string, init: RequestInit): Promise<Response> {
  const token = authStorage.read()?.accessToken;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`/api/clubplaza${path}`, { ...init, headers });
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { message?: string | string[]; error?: { message?: string } }
    | null;
  const message = payload?.error?.message ?? payload?.message;
  if (Array.isArray(message)) return message.join(", ");
  return typeof message === "string" && message ? message : fallback;
}

export async function clubplazaBulkImportPreview(file: File): Promise<PreviewResponse> {
  const form = new FormData();
  form.set("file", file);

  const response = await clubplazaProxyFetch("/bulk-import/preview", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "No se pudo procesar el archivo"));
  }

  return response.json() as Promise<PreviewResponse>;
}

export async function clubplazaBulkImportConfirm(data: ConfirmRequest): Promise<ImportResult> {
  const response = await clubplazaProxyFetch("/bulk-import/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "No se pudo confirmar la importación"));
  }

  return response.json() as Promise<ImportResult>;
}

// Contraseña inicial de los jugadores creados en Club Plaza. La regla es del
// backend (Apellido con primera mayúscula + últimos 3 dígitos del DNI); acá
// solo se replica para mostrarla, ej: ABARZUA + 28387875 -> "Abarzua875".
export function generatePassword(apellido: string, dni: string): string {
  if (!apellido || !dni) return "";
  const apellidoFormatted = apellido.charAt(0).toUpperCase() + apellido.slice(1).toLowerCase();
  return `${apellidoFormatted}${dni.slice(-3)}`;
}

// ----- Lookup de jugador por DNI (el alta trae los datos de Club Plaza) -----

export type ClubplazaPlayerLookup =
  | { found: false }
  | {
      found: true;
      nombre: string;
      apellido: string;
      nombre_completo: string;
      fecha_nacimiento: string | null;
      pagado: boolean;
    };

export async function clubplazaPlayerLookup(dni: string): Promise<ClubplazaPlayerLookup> {
  const response = await clubplazaProxyFetch(`/players/lookup?dni=${encodeURIComponent(dni)}`, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "No se pudo buscar el jugador"));
  }
  return response.json() as Promise<ClubplazaPlayerLookup>;
}

// ----- Planilla de registros (backend propio de SiniPro) -----

export const PAYMENT_METHODS = ["efectivo", "debito", "mp"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  mp: "MP"
};

export type Registration = {
  id: string;
  registered_on: string;
  player_full_name: string;
  player_dni: string;
  player_birth_date: string | null;
  // Quién pagó estos seguros (texto libre; un pagador puede pagar varios).
  payer_name: string | null;
  payment_method: PaymentMethod | null;
  attended_by_user_id: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  attended_by: { id: string; full_name: string } | null;
};

// Una fila está pendiente hasta completar pagador, pago y atendido (las que
// crea la carga masiva entran así).
export function isRegistrationPending(registration: Registration): boolean {
  return (
    registration.payment_method === null ||
    registration.attended_by_user_id === null ||
    registration.payer_name === null
  );
}

export type RegistrationFormPayload = {
  registeredOn: string;
  playerFullName: string;
  playerDni: string;
  playerBirthDate: string | null;
  payerName: string | null;
  paymentMethod: PaymentMethod | null;
  attendedByUserId: string | null;
};

// Edición inline desde la planilla: se manda solo la celda que cambió (los
// datos del jugador nunca se tocan desde acá).
export type RegistrationPatch = {
  registeredOn?: string;
  payerName?: string | null;
  paymentMethod?: PaymentMethod | null;
  attendedByUserId?: string | null;
};

// Corrección aplicada en Club Plaza por la carga masiva (conflicto aceptado),
// a replicar en las filas de la planilla que tengan ese DNI.
export type PlayerCorrection = {
  dni: string;
  newDni?: string;
  fullName?: string;
  birthDate?: string;
};

export type RegistrationFilters = {
  search: string;
  pagador: string;
  paymentMethod: string;
  attendedBy: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  birthDate: string;
};
