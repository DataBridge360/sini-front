import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Configuración de Gesti. Se lee de forma lazy (en el primer request) y no
// forma parte de serverEnv(): sin ANTHROPIC_API_KEY el resto de la API sigue
// andando y Gesti responde con un aviso en vez de fallar.

export const MODEL_MAIN = "claude-sonnet-5-5";
export const MODEL_FAST = "claude-haiku-5-5";

export const DEFAULT_MONTHLY_BUDGET_USD = 100;

/** El cliente que usa el módulo; los tests inyectan uno falso con esta forma. */
export type GestiAnthropic = Pick<Anthropic, "messages">;

export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Tope mensual global de la cuenta de la API, en USD (GESTI_MONTHLY_BUDGET_USD, 100 por defecto). */
export function monthlyBudgetUsd(): number {
  const parsed = Number(process.env.GESTI_MONTHLY_BUDGET_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_BUDGET_USD;
}

let cached: GestiAnthropic | null = null;

/** null si no hay API key configurada. */
export function getAnthropic(): GestiAnthropic | null {
  const apiKey = anthropicApiKey();
  if (!apiKey) return null;
  cached ??= new Anthropic({ apiKey, maxRetries: 1, timeout: 280_000 });
  return cached;
}
