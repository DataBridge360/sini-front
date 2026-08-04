/**
 * Service worker de SiniPro.
 *
 * Existe por dos razones:
 *  1. Chromium exige un service worker con handler de `fetch` para considerar
 *     al sitio instalable y disparar `beforeinstallprompt`.
 *  2. Que la app instalada no muestre el dinosaurio cuando se cae la red.
 *
 * Es deliberadamente conservador: SiniPro es multi-organización y todo vive
 * detrás del login, así que NO se cachea ningún HTML ni ninguna respuesta de la
 * API. Cachear datos de una organización sería filtrarlos a la siguiente sesión
 * del mismo dispositivo. Lo único que persiste son assets estáticos con hash
 * (/_next/static) y los iconos, que no dependen de quién esté logueado.
 *
 * `?dev=1` en la URL de registro apaga el cacheo de assets: en `next dev` los
 * chunks cambian en cada recompilación y servirlos desde caché rompe el HMR.
 */

const VERSION = "sinipro-pwa-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_CACHE = `${VERSION}-offline`;
const OFFLINE_URL = "/offline.html";

const DEV = new URL(self.location.href).searchParams.get("dev") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      // Sin skipWaiting una versión nueva del SW se quedaría esperando a que se
      // cierren todas las pestañas; con la app instalada eso puede ser días.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones: siempre red primero (el HTML nunca se cachea, ver arriba).
  // Si no hay red, se sirve la pantalla de "sin conexión".
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(OFFLINE_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("Sin conexión", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" }
            })
          );
        }
      })()
    );
    return;
  }

  if (DEV) return;

  // Assets inmutables: cache-first. Los chunks de Next llevan hash en el nombre,
  // así que una entrada cacheada nunca queda desactualizada.
  const isImmutable =
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

  if (!isImmutable) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
