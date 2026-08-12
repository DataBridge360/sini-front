const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthState = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number | null;
  user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    platformRole: string;
  };
  organizations: Array<{
    id: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
    loginLogoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    role: string;
  }>;
};

export type UserProfile = AuthState["user"];

export type OrganizationSettings = {
  id: string;
  slug: string;
  display_name: string;
  login_logo_url: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  support_email: string | null;
  support_phone: string | null;
  status: string;
};

export type PublicOrganization = Omit<OrganizationSettings, "id">;

export type OrganizationRole = "productor" | "asesor";

export type OrganizationTeamMember = {
  id: string;
  userId: string | null;
  fullName: string;
  email: string;
  role: OrganizationRole;
  isActive: boolean;
  createdAt: string;
};

export type CreateOrganizationTeamMemberPayload = {
  fullName: string;
  email: string;
  role: OrganizationRole;
  password: string;
};

export type UpdateOrganizationTeamMemberPayload = {
  fullName: string;
  email: string;
  role: OrganizationRole;
  producerPassword: string;
};

export type ChangeOrganizationTeamMemberPasswordPayload = {
  password: string;
  producerPassword: string;
};

export type DeactivateOrganizationTeamMemberPayload = {
  producerPassword: string;
};

export type UserRef = { id: string; full_name: string };

export type NoticeNote = {
  id: string;
  note: string;
  created_at: string;
  user_id: string;
  user: UserRef | null;
};

export type Client = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  locality: string | null;
  dni: string | null;
  notes: string | null;
  address: string | null;
  birth_date: string | null;
};

export type InsuranceCompany = {
  id: string;
  name: string;
  is_active: boolean;
};

// 'debito_automatico' cubre débito y tarjeta de crédito automáticos: la póliza
// se cobra sola y no genera avisos de cobranza.
export type PaymentMethod = "manual" | "debito_automatico";

export type Policy = {
  id: string;
  branch: string;
  policy_number: string;
  vehicle_plate: string | null;
  payment_interval_months: number;
  payment_method: PaymentMethod;
  first_payment_date: string;
  clients?: { id: string; full_name: string } | null;
  insurance_companies?: { id: string; name: string } | null;
};

export type Notice = {
  id: string;
  due_date: string;
  status: "avisar" | "avisado" | "pagado";
  paid_interval_months: number | null;
  notified_at: string | null;
  payment_processed_at: string | null;
  notified_by: UserRef | null;
  payment_processed_by: UserRef | null;
  notes: NoticeNote[];
  policies?: {
    id: string;
    policy_number: string;
    branch: string;
    vehicle_plate: string | null;
    clients?: { id: string; full_name: string; phone: string | null; email: string | null; notes: string | null } | null;
    insurance_companies?: { id: string; name: string } | null;
  } | null;
};

// 'finalizado' == archivada: sale del tablero y solo se ve en Archivadas.
export type TaskStatus = "pendiente" | "en_proceso" | "revision" | "finalizado";
export type TaskPriority = "alta" | "media" | "baja";

export type TaskAttachment = {
  id: string;
  // null en los adjuntos subidos antes de que colgaran de una actividad: se
  // muestran como "Archivos de la tarea".
  message_id: string | null;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_path: string;
  created_at: string;
  uploaded_by_user_id: string;
  uploaded_by: UserRef | null;
  // Signed URL temporal (bucket privado); se renueva en cada refetch.
  url: string | null;
};

export type TaskMessage = {
  id: string;
  // null cuando la actividad es solo archivos.
  message: string | null;
  created_at: string;
  user_id: string;
  user: UserRef | null;
  attachments: TaskAttachment[];
};

type TaskBase = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  assigned_to_user_id: string | null;
  created_by_user_id: string;
  approved_by_user_id: string | null;
  assigned_to: UserRef | null;
  created_by: UserRef | null;
  approved_by: UserRef | null;
  clients?: { id: string; full_name: string } | null;
  policies?: {
    id: string;
    policy_number: string;
    branch: string;
    vehicle_plate: string | null;
    clients?: { id: string; full_name: string } | null;
  } | null;
};

// Fila del tablero y de Archivadas: sin descripción ni adjuntos embebidos, solo
// contadores. El detalle se pide aparte con GET /tasks/:id.
export type TaskListItem = TaskBase & {
  messages_count: number;
  attachments_count: number;
};

export type TaskDetail = TaskBase & {
  // Documento TipTap en JSON.
  description: unknown;
  messages: TaskMessage[];
  // Solo los adjuntos sin actividad asociada (legacy).
  attachments: TaskAttachment[];
};

export type Task = TaskListItem;

// GET /tasks/stats: recuento por etapa, calculado con COUNT en el servidor.
// Nunca se derivan estos números del listado — 'finalizado' crece sin techo.
export type TaskStats = {
  pendiente: number;
  en_proceso: number;
  revision: number;
  finalizado: number;
  // pendiente + en_proceso + revision: lo que sigue vivo en el tablero.
  activas: number;
};

export type OrganizationMember = { id: string; full_name: string };

export type TaskFormPayload = {
  title: string;
  description: unknown;
  // Una tarea no nace en revisión ni archivada.
  status: "pendiente" | "en_proceso";
  priority: TaskPriority;
  dueDate: string | null;
  assignedToUserId: string | null;
  clientId: string | null;
  policyId: string | null;
};

type RequestOptions = {
  token?: string | undefined;
  organizationSlug?: string | undefined;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export type ApiCommonOptions = Pick<RequestOptions, "token" | "organizationSlug">;

// Respuesta de los listados con paginación server-side (PAGINADO.md).
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// Fila de /clients paginado: incluye el conteo de pólizas activas embebido.
export type ClientListItem = Client & { policies?: Array<{ count: number }> };

// Error de la API con el status y el `code` que manda el backend. Sigue siendo
// un Error común (quien solo usa .message no cambia), pero permite reaccionar a
// un conflicto puntual: p. ej. CLIENT_DUPLICATE_NAME pide el DNI en el formulario.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Códigos de conflicto de asegurados (espejo de backend/src/clients/clients.schemas.ts).
export const CLIENT_DUPLICATE_NAME = "CLIENT_DUPLICATE_NAME";
export const CLIENT_DUPLICATE_DNI = "CLIENT_DUPLICATE_DNI";

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const makeInit = (token = options.token): RequestInit => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (options.organizationSlug) {
      headers.set("X-Organization-Slug", options.organizationSlug);
    }

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    return init;
  };

  let response = await fetch(`${API_URL}${path}`, makeInit());
  if (response.status === 401 && options.token && !path.startsWith("/auth/")) {
    const refreshed = await refreshStoredAuth();
    if (refreshed?.accessToken) {
      response = await fetch(`${API_URL}${path}`, makeInit(refreshed.accessToken));
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.message === "string" ? payload.message : "No se pudo completar la operacion";
    throw new ApiError(message, response.status, typeof payload?.code === "string" ? payload.code : null);
  }

  return response.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  file: File,
  options: Pick<RequestOptions, "token" | "organizationSlug"> & { fields?: Record<string, string> } = {}
): Promise<T> {
  const makeInit = (token = options.token): RequestInit => {
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(options.fields ?? {})) {
      form.set(key, value);
    }

    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (options.organizationSlug) {
      headers.set("X-Organization-Slug", options.organizationSlug);
    }

    return {
      method: "POST",
      headers,
      body: form
    };
  };

  let response = await fetch(`${API_URL}${path}`, makeInit());
  if (response.status === 401 && options.token) {
    const refreshed = await refreshStoredAuth();
    if (refreshed?.accessToken) {
      response = await fetch(`${API_URL}${path}`, makeInit(refreshed.accessToken));
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.message === "string" ? payload.message : "No se pudo subir el archivo";
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// Subida multipart con progreso real. fetch() no expone el progreso de subida,
// así que acá va XHR: sin esto una actividad con 5 fotos es una ruedita sin
// información durante 20 segundos.
//
// `build` es una factory porque el FormData se consume al enviarse y hay que
// rearmarlo si el 401 obliga a reintentar con el token renovado.
export async function apiUploadForm<T>(
  path: string,
  build: () => FormData,
  options: ApiCommonOptions & { onProgress?: (fraction: number) => void } = {}
): Promise<T> {
  const send = (token = options.token) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `${API_URL}${path}`);
      if (token) {
        request.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      if (options.organizationSlug) {
        request.setRequestHeader("X-Organization-Slug", options.organizationSlug);
      }

      if (options.onProgress) {
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable && event.total > 0) {
            options.onProgress?.(event.loaded / event.total);
          }
        });
      }

      request.addEventListener("load", () =>
        resolve({ status: request.status, body: request.responseText })
      );
      request.addEventListener("error", () => reject(new Error("No se pudo conectar con el servidor")));
      request.addEventListener("abort", () => reject(new Error("Subida cancelada")));
      request.send(build());
    });

  let response = await send();
  if (response.status === 401 && options.token) {
    const refreshed = await refreshStoredAuth();
    if (refreshed?.accessToken) {
      response = await send(refreshed.accessToken);
    }
  }

  const payload = response.body ? (JSON.parse(response.body) as unknown) : null;

  if (response.status < 200 || response.status >= 300) {
    const message = (payload as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : "No se pudo enviar la actividad");
  }

  return payload as T;
}

const AUTH_STORAGE_KEY = "sinipro2.auth";
export const AUTH_CHANGED_EVENT = "sinipro2.auth.changed";
let authRefreshPromise: Promise<AuthState | null> | null = null;

// Exportada además de para el reintento del 401: el canal de tiempo real
// necesita renovar el token antes de que venza, porque un WebSocket abierto
// puede pasar horas sin hacer una sola request que dispare el 401.
export async function refreshStoredAuth() {
  if (authRefreshPromise) {
    return authRefreshPromise;
  }

  authRefreshPromise = refreshStoredAuthOnce();
  try {
    return await authRefreshPromise;
  } finally {
    authRefreshPromise = null;
  }
}

async function refreshStoredAuthOnce() {
  const current = authStorage.read();
  if (!current?.refreshToken) {
    return null;
  }

  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken })
  });

  if (!response.ok) {
    authStorage.clear();
    return null;
  }

  const refreshed = (await response.json()) as AuthState;
  authStorage.write(refreshed);
  return refreshed;
}

export const authStorage = {
  read(): AuthState | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthState;
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  },
  write(auth: AuthState) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    window.dispatchEvent(new CustomEvent<AuthState | null>(AUTH_CHANGED_EVENT, { detail: auth }));
  },
  clear() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent<AuthState | null>(AUTH_CHANGED_EVENT, { detail: null }));
  }
};

export function intervalLabel(months: number) {
  const labels: Record<number, string> = {
    1: "mensual",
    2: "bimestral",
    3: "trimestral",
    4: "cuatrimestral",
    6: "semestral",
    12: "anual"
  };
  return labels[months] ?? `cada ${months} meses`;
}

export function paymentMethodLabel(method: PaymentMethod) {
  return method === "debito_automatico" ? "Débito/crédito automático" : "Pago manual";
}
