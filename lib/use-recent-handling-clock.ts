"use client";

import { useEffect, useState } from "react";
import type { Notice } from "@/lib/api";
import { recentHandlingDeadline } from "@/lib/notices";

const MAX_TICK_MS = 10_000;

// Reloj para el cartel "lo avisó recién": devuelve la hora actual y la renueva
// cuando cambia la lista de avisos y, mientras haya algún cartel vigente, cada
// pocos segundos (para el "hace 1 minuto") y justo al vencer la ventana. Sin
// carteles vigentes no programa nada, así que la vista no se re-renderiza por el
// reloj. Entre un cambio de la lista y su renovación (un instante) rige la hora
// anterior.
export function useRecentHandlingClock(notices: Notice[], currentUserId: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  const deadline = recentHandlingDeadline(notices, currentUserId, now);

  // Llegó un cambio (por ejemplo, por tiempo real): se renueva la hora.
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, [notices, currentUserId]);

  // Mientras haya un cartel vigente, se renueva hasta que venza.
  useEffect(() => {
    if (deadline === null) return;
    const delay = Math.min(Math.max(deadline - Date.now(), 0) + 50, MAX_TICK_MS);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [deadline, now]);

  return now;
}
