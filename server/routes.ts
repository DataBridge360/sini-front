import type { Route } from "./core/router";

// Tabla completa de la API. El orden importa: gana la primera ruta que matchea
// (como en Express), así que los paths estáticos van antes que los ":param".
export const apiRoutes: Route[] = [];
