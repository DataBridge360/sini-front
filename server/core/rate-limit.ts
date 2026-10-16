// Rate limit en memoria, equivalente al ThrottlerModule de Nest.
//
// Ojo: en Vercel cada instancia de la función tiene su propio contador, así que
// el límite es por instancia ("best effort"), no global. Alcanza para frenar un
// loop o un script torpe contra /auth/login; para un ataque distribuido, la
// defensa es el rate limit propio de Supabase Auth y una regla del Firewall de
// Vercel sobre /api/v1/auth/*.
export class MemoryRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Registra un hit; devuelve false si la key superó `limit` en la ventana. */
  hit(key: string, limit: number, ttlMs: number): boolean {
    const now = this.now();
    if (this.hits.size > 10_000) {
      this.prune(now);
    }

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + ttlMs });
      return true;
    }

    entry.count += 1;
    return entry.count <= limit;
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) {
        this.hits.delete(key);
      }
    }
  }
}
