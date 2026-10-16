import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import { createInsuranceCompanySchema } from "./schemas";
import { InsuranceCompaniesService } from "./service";

const service = () => new InsuranceCompaniesService(getSupabase());

export const insuranceCompaniesRoutes: Route[] = [
  route({
    method: "GET",
    path: "/insurance-companies",
    access: "organization",
    handler: ({ organization }) => service().findAll(organization.id)
  }),
  route({
    method: "POST",
    path: "/insurance-companies",
    access: "organization",
    handler: async ({ organization, body }) =>
      service().create(organization.id, await body(createInsuranceCompanySchema))
  })
];
