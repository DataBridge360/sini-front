"use client";

// Todo lo relacionado con instalar SiniPro como aplicación (PWA).
//
// El flujo real de Chrome / Edge / Android es: el navegador decide que el sitio
// es instalable y dispara `beforeinstallprompt`. Si nadie lo cancela, el
// navegador se guarda la oferta para el ícono de la barra de direcciones y no
// muestra nada más. Nosotros lo cancelamos, nos quedamos con el evento y lo
// disparamos cuando el usuario toca "Instalar" — recién ahí aparece el diálogo
// nativo del navegador.
//
// `prompt()` solo se puede llamar una vez por evento y Chrome exige que sea a
// partir de un gesto del usuario, así que NO se puede abrir el diálogo nativo
// solo porque alguien inició sesión: hace falta el botón intermedio.
//
// iOS/Safari no implementa nada de esto. Ahí la única vía es Compartir →
// "Agregar a inicio", así que se detecta el caso y se muestran los pasos.

import { useCallback, useSyncExternalStore } from "react";

export type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
};

declare global {
  interface Window {
    // Lo deja el script inline de app/layout.tsx, que escucha el evento antes
    // de que React llegue a montar (Chrome puede dispararlo enseguida).
    __spInstallEvent?: BeforeInstallPromptEvent | null;
  }
}

export const INSTALL_AVAILABLE_EVENT = "sp:installavailable";

const DISMISSED_KEY = "sinipro.pwa-install-dismissed-at";
const DISMISS_DAYS = 14;

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari en iOS no soporta display-mode y usa esta propiedad propietaria.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (/iphone|ipod/i.test(ua)) return true;
  // iPad con iPadOS 13+ se hace pasar por Mac de escritorio; el touch lo delata.
  return /ipad/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isRecentlyDismissed() {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(DISMISSED_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

// El descarte vive en localStorage, que no emite eventos en la misma pestaña:
// hace falta un store propio para que useSyncExternalStore se entere.
const dismissListeners = new Set<() => void>();

function rememberDismissal() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  dismissListeners.forEach((listener) => listener());
}

function subscribeDismissed(onChange: () => void) {
  dismissListeners.add(onChange);
  return () => {
    dismissListeners.delete(onChange);
  };
}

function subscribeInstallEvent(onChange: () => void) {
  window.addEventListener(INSTALL_AVAILABLE_EVENT, onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    window.removeEventListener(INSTALL_AVAILABLE_EVENT, onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

function subscribeStandalone(onChange: () => void) {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  displayMode.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    displayMode.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

// Nada que suscribir: si el dispositivo es iOS no cambia durante la sesión.
// useSyncExternalStore igual es la forma correcta de leerlo, porque mantiene
// coherentes el render del servidor (false) y el del cliente.
function subscribeNever() {
  return () => {};
}

function readInstallEvent() {
  return window.__spInstallEvent ?? null;
}

/**
 * Registra el service worker, que es lo que habilita `beforeinstallprompt` en
 * Chromium (además de la pantalla de "sin conexión").
 *
 * En `next dev` se registra con `?dev=1` para que el worker no cachee los
 * chunks de Next, que cambian en cada recompilación.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";
  navigator.serviceWorker.register(url, { scope: "/" }).catch(() => {
    // Un registro fallido solo significa que no hay modo offline ni oferta de
    // instalación: la app sigue funcionando igual, no hay nada que avisarle
    // al usuario.
  });
}

export type InstallState = {
  /** El navegador ofreció instalar y tenemos el evento guardado. */
  canPromptNatively: boolean;
  /** iOS: no hay API, hay que explicar Compartir → Agregar a inicio. */
  needsIosInstructions: boolean;
  /** Ya está instalada (se abrió desde el ícono, sin barra del navegador). */
  installed: boolean;
  /** Abre el diálogo nativo. Devuelve true si el usuario aceptó instalar. */
  promptInstall: () => Promise<boolean>;
  /** Oculta la oferta y no vuelve a mostrarla por 14 días. */
  dismiss: () => void;
};

export function useInstallPrompt(): InstallState {
  // Cada valor se lee como primitiva (o como la misma referencia de evento):
  // getSnapshot no puede devolver un objeto nuevo en cada llamada.
  const event = useSyncExternalStore(subscribeInstallEvent, readInstallEvent, () => null);
  const installed = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const dismissed = useSyncExternalStore(subscribeDismissed, isRecentlyDismissed, () => true);
  const ios = useSyncExternalStore(subscribeNever, isIosDevice, () => false);

  const promptInstall = useCallback(async () => {
    if (!event) return false;
    // El evento se consume de una sola vez. Si el usuario cancela, Chrome lo
    // vuelve a disparar más adelante y el listener del layout lo repone.
    window.__spInstallEvent = null;
    window.dispatchEvent(new Event(INSTALL_AVAILABLE_EVENT));
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome !== "accepted") rememberDismissal();
    return choice.outcome === "accepted";
  }, [event]);

  return {
    canPromptNatively: Boolean(event) && !installed && !dismissed,
    needsIosInstructions: ios && !installed && !dismissed,
    installed,
    promptInstall,
    dismiss: rememberDismissal
  };
}
