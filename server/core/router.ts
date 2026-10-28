import type { ZodType } from "zod";
import type { AuthUser, OrganizationContext } from "./context";
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException
} from "./http-errors";
import { Logger } from "./logger";
import { isUuid } from "./postgrest";
import type { MemoryRateLimiter } from "./rate-limit";

// Router de la API. Reemplaza a los controllers, guards y pipes de Nest con una
// tabla de rutas explícita: cada ruta DEBE declarar su `access`, así que
// auditar quién puede llamar a qué es leer la tabla.
//
//   public       -> sin autenticación (login, branding por slug)
//   user         -> AuthGuard: bearer token válido + perfil activo
//   organization -> AuthGuard + OrganizationGuard: membresía activa (o admin de
//                   plataforma) en una organización activa
//
// Orden por request, igual que en Nest: rate limit -> auth -> organización ->
// handler (que valida params/query/body con Zod).

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type Access = "public" | "user" | "organization";

const JSON_BODY_LIMIT_BYTES = 256 * 1024;
const DEFAULT_RATE_LIMIT = { limit: 300, ttlMs: 60_000 };

export type RateLimit = { limit: number; ttlMs: number };

type BaseContext = {
  request: Request;
  headers: Headers;
  params: Record<string, string>;
  ip: string;
  setHeader: (name: string, value: string) => void;
  /** Lee el body JSON (con el límite de la ruta) y lo valida como ZodValidationPipe. */
  body: <T>(schema: ZodType<T>) => Promise<T>;
  /** Valida el query string; las keys repetidas llegan como array. */
  query: <T>(schema: ZodType<T>) => T;
  /** Equivalente a ParseUUIDPipe. */
  uuidParam: (name: string) => string;
  /** Lee un multipart/form-data con un tope total de bytes. */
  formData: (maxBytes: number) => Promise<FormData>;
};

export type RouteContext<A extends Access> = BaseContext &
  (A extends "organization"
    ? { user: AuthUser; organization: OrganizationContext }
    : A extends "user"
      ? { user: AuthUser }
      : Record<never, never>);

export type RouteDefinition<A extends Access> = {
  method: HttpMethod;
  /** Path relativo a la base, con params estilo Express: "/tasks/:id". */
  path: string;
  access: A;
  bodyLimitBytes?: number;
  rateLimit?: RateLimit;
  handler: (context: RouteContext<A>) => unknown;
};

export type Route = {
  method: HttpMethod;
  path: string;
  access: Access;
  bodyLimitBytes: number;
  rateLimit: RateLimit;
  segments: string[];
  handler: (context: RouteContext<Access> & Partial<{ user: AuthUser; organization: OrganizationContext }>) => unknown;
};

export function route<A extends Access>(definition: RouteDefinition<A>): Route {
  return {
    method: definition.method,
    path: definition.path,
    access: definition.access,
    bodyLimitBytes: definition.bodyLimitBytes ?? JSON_BODY_LIMIT_BYTES,
    rateLimit: definition.rateLimit ?? DEFAULT_RATE_LIMIT,
    segments: splitPath(definition.path),
    handler: definition.handler as Route["handler"]
  };
}

export type ApiDependencies = {
  basePath: string;
  authenticate: (headers: Headers) => Promise<AuthUser>;
  resolveOrganization: (headers: Headers, user: AuthUser) => Promise<OrganizationContext>;
  rateLimiter: MemoryRateLimiter;
};

const logger = new Logger("api");

export function createApiHandler(routes: Route[], deps: ApiDependencies) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(deps.basePath)
      ? url.pathname.slice(deps.basePath.length) || "/"
      : url.pathname;

    try {
      const match = matchRoute(routes, request.method, path);
      if (!match) {
        throw new NotFoundException(`Cannot ${request.method} ${path}`);
      }

      const { route: matched, params } = match;
      const ip = clientIp(request.headers);
      const rateKey = `${matched.method} ${matched.path}|${ip}`;
      if (!deps.rateLimiter.hit(rateKey, matched.rateLimit.limit, matched.rateLimit.ttlMs)) {
        throw new HttpException(
          { statusCode: 429, message: "ThrottlerException: Too Many Requests" },
          429
        );
      }

      const responseHeaders = new Headers();
      const context: RouteContext<Access> & { user?: AuthUser; organization?: OrganizationContext } = {
        request,
        headers: request.headers,
        params,
        ip,
        setHeader: (name, value) => responseHeaders.set(name, value),
        body: async (schema) => validate(schema, await readJsonBody(request, matched.bodyLimitBytes)),
        query: (schema) => validate(schema, queryObject(url.searchParams)),
        uuidParam: (name) => {
          const value = params[name];
          if (!value || !isUuid(value)) {
            throw new BadRequestException("Validation failed (uuid is expected)");
          }
          return value;
        },
        formData: (maxBytes) => readFormData(request, maxBytes)
      };

      if (matched.access !== "public") {
        context.user = await deps.authenticate(request.headers);
      }
      if (matched.access === "organization" && context.user) {
        context.organization = await deps.resolveOrganization(request.headers, context.user);
      }

      const result = await matched.handler(context);
      // Un handler que ya arma su Response (p. ej. un stream NDJSON) se devuelve
      // tal cual: status, headers y body son suyos.
      if (result instanceof Response) {
        return result;
      }
      const status = request.method === "POST" ? 201 : 200;
      if (result === undefined) {
        return new Response(null, { status, headers: responseHeaders });
      }
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(result), { status, headers: responseHeaders });
    } catch (error) {
      return errorResponse(error, request.method, path);
    }
  };
}

function errorResponse(error: unknown, method: string, path: string): Response {
  if (error instanceof HttpException) {
    return Response.json(error.body, { status: error.status });
  }

  logger.error(`${method} ${path}: unhandled error`, error);
  return Response.json({ statusCode: 500, message: "Internal server error" }, { status: 500 });
}

function matchRoute(routes: Route[], method: string, path: string) {
  const segments = splitPath(path);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) {
      continue;
    }

    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < segments.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = segments[index] as string;
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeSegment(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route: candidate, params };
    }
  }
  return null;
}

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new BadRequestException("Malformed URL parameter");
  }
}

function clientIp(headers: Headers) {
  // Vercel pisa x-forwarded-for/x-real-ip con la IP real del cliente.
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function validate<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({ message: "Validation failed", issues: result.error.issues });
  }
  return result.data;
}

function queryObject(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams) {
    const current = query[key];
    if (current === undefined) {
      query[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      query[key] = [current, value];
    }
  }
  return query;
}

function tooLarge() {
  return new PayloadTooLargeException("request entity too large");
}

async function readLimitedBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge();
  }
  if (!request.body) {
    return new Uint8Array();
  }

  // El content-length puede faltar o mentir: se cuenta lo que realmente llega.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Se deja de leer sin cancel(): cancelar el body de undici a mitad de un
      // chunk dispara un ERR_INVALID_STATE no manejado. El resto se descarta.
      reader.releaseLock();
      throw tooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readLimitedBytes(request, maxBytes);
  if (bytes.byteLength === 0) {
    return undefined;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // Igual que express.json(): un body que no es JSON no se interpreta.
    return undefined;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BadRequestException("Invalid JSON body");
  }
}

async function readFormData(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new BadRequestException("Expected multipart/form-data");
  }

  const bytes = await readLimitedBytes(request, maxBytes);
  try {
    return await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new BadRequestException("Malformed multipart body");
  }
}
