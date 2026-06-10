import type { MetadataRoute } from "next";

/**
 * Sinipro2 es una aplicación SaaS privada multi-organización: todo el contenido
 * vive detrás del login y se sirve por subdominio de cada organización.
 * No hay contenido público que indexar, por lo que se bloquea a todos los crawlers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/"
    }
  };
}
