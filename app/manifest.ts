import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA, servido por Next en /manifest.webmanifest.
 *
 * Es lo que hace que Chrome / Edge / Android ofrezcan instalar la app, y lo que
 * define cómo se ve una vez instalada (nombre, icono, ventana sin barra del
 * navegador). Junto con el service worker de /sw.js cubre los requisitos de
 * instalabilidad de Chromium.
 *
 * `start_url` y `scope` son relativos al origen, así que cada subdominio de
 * organización se instala como su propia app y arranca en su propio login.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SiniPro",
    short_name: "SiniPro",
    description: "Gestión de pólizas, avisos y tareas para productores de seguros.",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    background_color: "#f4f7f6",
    theme_color: "#ffffff",
    categories: ["business", "productivity", "finance"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      // Los maskable dejan que Android recorte el icono a la forma del launcher
      // (círculo, squircle, etc.) sin comerse el escudo: van a sangre y con el
      // dibujo dentro de la zona segura central.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
