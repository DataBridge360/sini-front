// Helpers SOLO de servidor para el proxy hacia Club Plaza.
//
// Las credenciales del productor viven en variables de entorno sin prefijo
// NEXT_PUBLIC_ (CLUBPLAZA_*), por lo que nunca llegan al bundle del navegador.
// El JWT de Club Plaza dura 8 h y no tiene refresh: se cachea en memoria y se
// renueva por login cuando está por vencer o si Club Plaza devuelve 401.

export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

type ClubplazaSession = {
  token: string;
  productorId: string;
  expiresAt: number;
};

let cachedSession: ClubplazaSession | null = null;
let loginPromise: Promise<ClubplazaSession> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ProxyError(
      `Falta configurar ${name} en el .env del frontend (integración Club Plaza)`,
      500
    );
  }
  return value;
}

export function getClubplazaClubId(): string {
  return requiredEnv("CLUBPLAZA_CLUB_ID");
}

// Valida que quien llama al proxy tenga una sesión activa de SiniPro,
// consultando GET /profile del backend propio con el token recibido.
export async function requireSiniproSession(request: Request): Promise<void> {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new ProxyError("Necesitás iniciar sesión en SiniPro", 401);
  }

  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const headers = new Headers({ Authorization: authorization });
  const organizationSlug = request.headers.get("x-organization-slug");
  if (organizationSlug) {
    headers.set("X-Organization-Slug", organizationSlug);
  }

  const response = await fetch(`${backendUrl}/profile`, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new ProxyError("Sesión de SiniPro inválida o expirada", 401);
  }
}

async function loginToClubplaza(): Promise<ClubplazaSession> {
  const apiUrl = requiredEnv("CLUBPLAZA_API_URL");
  const usuario = requiredEnv("CLUBPLAZA_USUARIO");
  const password = requiredEnv("CLUBPLAZA_PASSWORD");

  const response = await fetch(`${apiUrl}/auth/login/usuario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, password }),
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: { token?: string; user?: { id?: string } };
    message?: string;
  } | null;

  if (!response.ok || !payload?.data?.token || !payload.data.user?.id) {
    throw new ProxyError(
      payload?.message ?? "No se pudo iniciar sesión en Club Plaza con las credenciales configuradas",
      502
    );
  }

  return {
    token: payload.data.token,
    productorId: payload.data.user.id,
    // El JWT dura 8 h; se renueva a las 7.5 h para no operar con un token al límite.
    expiresAt: Date.now() + 7.5 * 60 * 60 * 1000
  };
}

async function getClubplazaSession(forceRefresh = false): Promise<ClubplazaSession> {
  if (!forceRefresh && cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession;
  }
  if (!loginPromise) {
    loginPromise = loginToClubplaza();
  }
  try {
    cachedSession = await loginPromise;
    return cachedSession;
  } catch (error) {
    cachedSession = null;
    throw error;
  } finally {
    loginPromise = null;
  }
}

// Ejecuta una request autenticada contra Club Plaza. Si el token cacheado fue
// invalidado (reinicio del backend, cambio de contraseña), reloguea una vez.
export async function clubplazaFetch(
  path: string,
  buildInit: (session: ClubplazaSession) => RequestInit
): Promise<Response> {
  const apiUrl = requiredEnv("CLUBPLAZA_API_URL");

  const doFetch = async (session: ClubplazaSession) => {
    const init = buildInit(session);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.token}`);
    return fetch(`${apiUrl}${path}`, { ...init, headers, cache: "no-store" });
  };

  let response = await doFetch(await getClubplazaSession());
  if (response.status === 401) {
    response = await doFetch(await getClubplazaSession(true));
  }
  return response;
}

// Reenvía la respuesta de Club Plaza tal cual (status + JSON) al navegador.
export async function passthrough(response: Response): Promise<Response> {
  const payload = (await response.json().catch(() => null)) as unknown;
  return Response.json(payload ?? { message: "Respuesta inválida de Club Plaza" }, {
    status: response.status
  });
}

export function proxyErrorResponse(error: unknown): Response {
  if (error instanceof ProxyError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  console.error("[clubplaza-proxy]", error);
  return Response.json({ message: "Error interno del proxy de Club Plaza" }, { status: 500 });
}
