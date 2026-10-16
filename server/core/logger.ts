// Logger mínimo con la misma firma que el Logger de NestJS que usaban los
// servicios. En Vercel la salida de consola queda en los logs de la función.
export class Logger {
  constructor(private readonly context: string) {}

  log(message: string, ...meta: unknown[]) {
    console.log(`[${this.context}] ${message}`, ...meta);
  }

  warn(message: string, ...meta: unknown[]) {
    console.warn(`[${this.context}] ${message}`, ...meta);
  }

  error(message: string, ...meta: unknown[]) {
    console.error(`[${this.context}] ${message}`, ...meta);
  }
}
