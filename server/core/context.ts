import { ForbiddenException, UnauthorizedException } from "./http-errors";
import type { SupabaseService } from "./supabase";

// Port 1:1 de AuthGuard + OrganizationGuard del backend Nest
// (backend/src/common/*.guard.ts). Cualquier cambio acá cambia quién puede
// leer qué: revisarlo con el mismo cuidado que una policy de RLS.

export type PlatformRole = "platform_admin" | "user";
export type OrganizationRole = "productor" | "asesor";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  platformRole: PlatformRole;
};

export type OrganizationContext = {
  id: string;
  slug: string;
  displayName: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  role: OrganizationRole | "platform_admin";
};

type OrganizationRow = {
  id: string;
  slug: string;
  display_name: string;
  primary_color: string | null;
  secondary_color: string | null;
  status: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolveOrganizationSlug(headers: Headers): string | null {
  const headerSlug = headers.get("x-organization-slug")?.trim().toLowerCase();
  if (headerSlug) {
    return headerSlug;
  }

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const hostname = host?.split(",")[0]?.trim().split(":")[0]?.toLowerCase();
  if (!hostname || LOCAL_HOSTS.has(hostname)) {
    return null;
  }

  const [firstLabel] = hostname.split(".");
  if (!firstLabel || firstLabel === "www") {
    return null;
  }

  return firstLabel;
}

export function extractBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim() || null;
}

export async function authenticate(headers: Headers, supabase: SupabaseService): Promise<AuthUser> {
  const token = extractBearerToken(headers);
  if (!token) {
    throw new UnauthorizedException("Missing bearer token");
  }

  const { data: authData, error: authError } = await supabase.admin.auth.getUser(token);
  if (authError || !authData.user?.id) {
    throw new UnauthorizedException("Invalid bearer token");
  }

  const { data: profile, error: profileError } = await supabase.admin
    .from("user_profiles")
    .select("id,email,full_name,avatar_url,platform_role,is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) {
    throw new UnauthorizedException("Inactive or missing profile");
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    platformRole: profile.platform_role
  };
}

export async function resolveOrganization(
  headers: Headers,
  user: AuthUser,
  supabase: SupabaseService
): Promise<OrganizationContext> {
  const slug = resolveOrganizationSlug(headers);
  if (!slug) {
    throw new ForbiddenException("Organization slug is required");
  }

  // Platform admins do not require an active membership, so they cannot rely on
  // the membership join below. Resolve the organization in a single query.
  if (user.platformRole === "platform_admin") {
    const { data: organization, error: orgError } = await supabase.admin
      .from("organizations")
      .select("id,slug,display_name,primary_color,secondary_color,status")
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle<OrganizationRow>();

    if (orgError || !organization) {
      throw new ForbiddenException("Organization not found");
    }

    return toOrganizationContext(organization, "platform_admin");
  }

  // Single round-trip: join membership -> organization (inner) filtering by the
  // organization slug + active status and the active membership for this user.
  const { data: membership, error: membershipError } = await supabase.admin
    .from("organization_memberships")
    .select(
      "role,is_active,organizations!inner(id,slug,display_name,primary_color,secondary_color,status)"
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("organizations.slug", slug)
    .eq("organizations.status", "active")
    .maybeSingle<{
      role: OrganizationRole;
      is_active: boolean;
      organizations: OrganizationRow;
    }>();

  if (membershipError || !membership?.organizations) {
    throw new ForbiddenException("User has no access to this organization");
  }

  return toOrganizationContext(membership.organizations, membership.role);
}

function toOrganizationContext(
  organization: OrganizationRow,
  role: OrganizationContext["role"]
): OrganizationContext {
  return {
    id: organization.id,
    slug: organization.slug,
    displayName: organization.display_name,
    primaryColor: organization.primary_color,
    secondaryColor: organization.secondary_color,
    role
  };
}
