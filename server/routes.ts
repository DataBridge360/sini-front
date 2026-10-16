import type { Route } from "./core/router";
import { authRoutes } from "./modules/auth/routes";
import { clientsRoutes } from "./modules/clients/routes";
import { clubPlazaRegistrationsRoutes } from "./modules/club-plaza-registrations/routes";
import { insuranceCompaniesRoutes } from "./modules/insurance-companies/routes";
import { noticesRoutes } from "./modules/notices/routes";
import { organizationsRoutes } from "./modules/organizations/routes";
import { policiesRoutes } from "./modules/policies/routes";
import { profileRoutes } from "./modules/profile/routes";
import { tasksRoutes } from "./modules/tasks/routes";

// Tabla completa de la API. El orden importa: gana la primera ruta que matchea
// (como en Express), así que los paths estáticos van antes que los ":param".
// Mismo orden de registro que el AppModule de Nest.
export const apiRoutes: Route[] = [
  ...authRoutes,
  ...organizationsRoutes,
  ...insuranceCompaniesRoutes,
  ...clientsRoutes,
  ...policiesRoutes,
  ...noticesRoutes,
  ...profileRoutes,
  ...tasksRoutes,
  ...clubPlazaRegistrationsRoutes
];
