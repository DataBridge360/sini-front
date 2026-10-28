import { BadRequestException, type HttpException } from "./http-errors";
import type { Logger } from "./logger";

type SupabaseErrorLike = {
  message?: string;
  code?: string | null | undefined;
  details?: string | null | undefined;
  hint?: string | null | undefined;
} | null;

/**
 * Logs the raw Supabase/Postgres error server-side and returns a safe,
 * user-friendly exception in Spanish without leaking internal column or
 * constraint names. Unique-violation errors (Postgres code 23505) get a
 * clearer message.
 */
export function supabaseError(
  logger: Logger,
  context: string,
  error: SupabaseErrorLike,
  fallbackMessage = "No se pudo completar la operación."
): HttpException {
  logger.error(
    `${context}: ${error?.message ?? "unknown error"}`,
    error?.details ?? error?.code ?? undefined
  );

  if (error?.code === "23505") {
    return new BadRequestException("Ya existe un registro con esos datos.");
  }

  return new BadRequestException(fallbackMessage);
}
