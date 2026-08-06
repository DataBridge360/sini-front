"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";

/**
 * Registra el service worker apenas carga cualquier pantalla, incluido el login.
 *
 * Va antes del login a propósito: Chrome recién considera al sitio instalable
 * cuando ya hay un service worker activo, y queremos que la oferta de instalar
 * esté lista para el momento en que el usuario entra.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
