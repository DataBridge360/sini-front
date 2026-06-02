const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthState = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    platformRole: string;
  };
  organizations: Array<{
    id: string;
    slug: string;
    displayName: string;
    primaryColor: string | null;
    secondaryColor: string | null;
    role: string;
  }>;
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
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
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

  const response = await fetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.message === "string" ? payload.message : "No se pudo completar la operacion";
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const authStorage = {
  read(): AuthState | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("sinipro2.auth");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthState;
    } catch {
      window.localStorage.removeItem("sinipro2.auth");
      return null;
    }
  },
  write(auth: AuthState) {
    window.localStorage.setItem("sinipro2.auth", JSON.stringify(auth));
  },
  clear() {
    window.localStorage.removeItem("sinipro2.auth");
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
