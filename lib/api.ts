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

export type Client = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  locality: string | null;
  dni: string | null;
};

export type InsuranceCompany = {
  id: string;
  name: string;
  is_active: boolean;
};

export type Policy = {
  id: string;
  branch: string;
  policy_number: string;
  vehicle_plate: string | null;
  payment_interval_months: number;
  first_payment_date: string;
  clients?: { id: string; full_name: string } | null;
  insurance_companies?: { id: string; name: string } | null;
};

export type Notice = {
  id: string;
  due_date: string;
  status: "avisar" | "avisado" | "pagado";
  paid_interval_months: number | null;
  policies?: {
    id: string;
    policy_number: string;
    branch: string;
    vehicle_plate: string | null;
    clients?: { id: string; full_name: string; phone: string | null; email: string | null } | null;
    insurance_companies?: { id: string; name: string } | null;
  } | null;
};

type RequestOptions = {
  token?: string | undefined;
  organizationSlug?: string | undefined;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

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
    throw new Error(message);
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

const AUTH_STORAGE_KEY = "sinipro2.auth";
export const AUTH_CHANGED_EVENT = "sinipro2.auth.changed";
let authRefreshPromise: Promise<AuthState | null> | null = null;

async function refreshStoredAuth() {
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
