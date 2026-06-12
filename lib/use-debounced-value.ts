"use client";

import { useEffect, useState } from "react";

// Devuelve el valor recién después de `delayMs` sin cambios: evita disparar
// una request al servidor por cada tecla en los buscadores paginados.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
