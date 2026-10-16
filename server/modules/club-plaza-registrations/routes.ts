import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import {
  applyCorrectionsSchema,
  bulkCreateRegistrationsSchema,
  createRegistrationSchema,
  listPayersQuerySchema,
  listRegistrationsQuerySchema,
  updateRegistrationSchema
} from "./schemas";
import { ClubPlazaRegistrationsService } from "./service";

const service = () => new ClubPlazaRegistrationsService(getSupabase());

// Planilla de pagos de jugadores de Club Plaza: accesible a cualquier miembro
// de la organización (productor y asesor), igual que la planilla en papel.
export const clubPlazaRegistrationsRoutes: Route[] = [
  route({
    method: "GET",
    path: "/club-plaza-registrations",
    access: "organization",
    handler: ({ organization, query }) =>
      service().findPage(organization.id, query(listRegistrationsQuerySchema))
  }),

  // Va antes de cualquier ruta con parámetro para que "payers" no se coma un :id.
  route({
    method: "GET",
    path: "/club-plaza-registrations/payers",
    access: "organization",
    handler: ({ organization, query }) =>
      service().findPayers(organization.id, query(listPayersQuerySchema))
  }),

  route({
    method: "POST",
    path: "/club-plaza-registrations",
    access: "organization",
    handler: async ({ organization, user, body }) =>
      service().create(organization, user, await body(createRegistrationSchema))
  }),

  route({
    method: "POST",
    path: "/club-plaza-registrations/bulk",
    access: "organization",
    handler: async ({ organization, user, body }) =>
      service().bulkCreate(organization, user, await body(bulkCreateRegistrationsSchema))
  }),

  route({
    method: "POST",
    path: "/club-plaza-registrations/corrections",
    access: "organization",
    handler: async ({ organization, body }) =>
      service().applyCorrections(organization.id, await body(applyCorrectionsSchema))
  }),

  route({
    method: "PATCH",
    path: "/club-plaza-registrations/:id",
    access: "organization",
    handler: async ({ organization, uuidParam, body }) => {
      const id = uuidParam("id");
      return service().update(organization, id, await body(updateRegistrationSchema));
    }
  }),

  route({
    method: "DELETE",
    path: "/club-plaza-registrations/:id",
    access: "organization",
    handler: ({ organization, user, uuidParam }) =>
      service().remove(organization, user, uuidParam("id"))
  })
];
