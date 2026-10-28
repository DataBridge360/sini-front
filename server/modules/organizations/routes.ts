import "server-only";
import { BadRequestException, PayloadTooLargeException } from "@/server/core/http-errors";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import {
  changeOrganizationTeamMemberPasswordSchema,
  createOrganizationTeamMemberSchema,
  deactivateOrganizationTeamMemberSchema,
  updateOrganizationSchema,
  updateOrganizationTeamMemberSchema
} from "./schemas";
import { OrganizationsService } from "./service";

const service = () => new OrganizationsService(getSupabase());

// FileInterceptor("file", { limits: { fileSize: 2_000_000 } })
const LOGO_FILE_LIMIT_BYTES = 2_000_000;
// Margen para los boundaries y los campos de texto del multipart.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type UploadedLogoFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

// Reproduce multer: un request que no es multipart llega sin archivo ni campos,
// un archivo en otro campo que "file" es "Unexpected field" y un archivo que
// excede el límite es 413 "File too large".
async function readLogoUpload(request: Request, formData: (maxBytes: number) => Promise<FormData>) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { kind: undefined, file: undefined };
  }

  const form = await formData(LOGO_FILE_LIMIT_BYTES + MULTIPART_OVERHEAD_BYTES);

  let upload: File | undefined;
  for (const [field, value] of form) {
    if (typeof value === "string") continue;
    if (field !== "file") {
      throw new BadRequestException("Unexpected field");
    }
    if (value.size > LOGO_FILE_LIMIT_BYTES) {
      throw new PayloadTooLargeException("File too large");
    }
    upload ??= value;
  }

  const kinds = form.getAll("kind");
  const kind = kinds.length === 1 && typeof kinds[0] === "string" ? kinds[0] : undefined;

  if (!upload) {
    return { kind, file: undefined };
  }

  const file: UploadedLogoFile = {
    originalname: upload.name,
    mimetype: upload.type,
    buffer: Buffer.from(await upload.arrayBuffer()),
    size: upload.size
  };
  return { kind, file };
}

export const organizationsRoutes: Route[] = [
  route({
    method: "GET",
    path: "/organizations/slug/:slug",
    access: "public",
    handler: ({ params }) => service().getPublicBySlug(params.slug as string)
  }),
  route({
    method: "GET",
    path: "/organizations/current",
    access: "organization",
    handler: ({ organization }) => service().getCurrent(organization.id)
  }),
  route({
    method: "PATCH",
    path: "/organizations/current",
    access: "organization",
    handler: async ({ organization, body }) =>
      service().updateCurrent(organization, await body(updateOrganizationSchema))
  }),
  route({
    method: "GET",
    path: "/organizations/current/team",
    access: "organization",
    handler: ({ organization }) => service().listTeam(organization)
  }),
  // Listado liviano (id + nombre) para asignar tareas: accesible a cualquier
  // miembro, a diferencia de /current/team que es solo para productores.
  route({
    method: "GET",
    path: "/organizations/current/members",
    access: "organization",
    handler: ({ organization }) => service().listMembers(organization)
  }),
  route({
    method: "POST",
    path: "/organizations/current/team",
    access: "organization",
    handler: async ({ organization, body }) =>
      service().createTeamMember(organization, await body(createOrganizationTeamMemberSchema))
  }),
  route({
    method: "PATCH",
    path: "/organizations/current/team/:membershipId",
    access: "organization",
    handler: async ({ user, organization, uuidParam, body }) =>
      service().updateTeamMember(
        user,
        organization,
        uuidParam("membershipId"),
        await body(updateOrganizationTeamMemberSchema)
      )
  }),
  route({
    method: "PATCH",
    path: "/organizations/current/team/:membershipId/password",
    access: "organization",
    handler: async ({ user, organization, uuidParam, body }) =>
      service().changeTeamMemberPassword(
        user,
        organization,
        uuidParam("membershipId"),
        await body(changeOrganizationTeamMemberPasswordSchema)
      )
  }),
  route({
    method: "PATCH",
    path: "/organizations/current/team/:membershipId/deactivate",
    access: "organization",
    handler: async ({ user, organization, uuidParam, body }) =>
      service().deactivateTeamMember(
        user,
        organization,
        uuidParam("membershipId"),
        await body(deactivateOrganizationTeamMemberSchema)
      )
  }),
  route({
    method: "POST",
    path: "/organizations/current/logo",
    access: "organization",
    handler: async ({ organization, request, formData }) => {
      const { kind, file } = await readLogoUpload(request, formData);
      return service().uploadLogo(organization, kind === "login" ? "login" : "main", file);
    }
  })
];
