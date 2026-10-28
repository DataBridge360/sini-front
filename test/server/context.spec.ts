import { describe, expect, it } from "vitest";
import {
  authenticate,
  resolveOrganization,
  resolveOrganizationSlug,
  type AuthUser
} from "@/server/core/context";
import type { SupabaseService } from "@/server/core/supabase";

type QueryResult = { data: unknown; error: unknown };

// Stub mínimo del query builder de supabase-js: registra los filtros y devuelve
// el resultado configurado por tabla.
function fakeSupabase(options: {
  user?: { id: string } | null;
  tables?: Record<string, QueryResult>;
}) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = (table: string) => {
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([table, column, value]);
        return chain;
      },
      maybeSingle: async () => options.tables?.[table] ?? { data: null, error: null }
    };
    return chain;
  };
  const supabase = {
    admin: {
      auth: {
        getUser: async (token: string) =>
          token === "good" && options.user
            ? { data: { user: options.user }, error: null }
            : { data: { user: null }, error: { message: "invalid" } }
      },
      from: builder
    }
  } as unknown as SupabaseService;
  return { supabase, filters };
}

const profileRow = {
  id: "user-1",
  email: "ana@example.com",
  full_name: "Ana",
  avatar_url: null,
  platform_role: "user",
  is_active: true
};

const orgRow = {
  id: "org-1",
  slug: "norte",
  display_name: "Norte",
  primary_color: "#000",
  secondary_color: null,
  status: "active"
};

const user: AuthUser = {
  id: "user-1",
  email: "ana@example.com",
  fullName: "Ana",
  avatarUrl: null,
  platformRole: "user"
};

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("resolveOrganizationSlug", () => {
  it("prefers x-organization-slug for local development", () => {
    expect(resolveOrganizationSlug(headers({ "x-organization-slug": "Acme", host: "localhost:3001" }))).toBe("acme");
  });

  it("resolves subdomain from host", () => {
    expect(resolveOrganizationSlug(headers({ host: "norte.sinipro.com" }))).toBe("norte");
  });

  it("prefers x-forwarded-host over host", () => {
    expect(resolveOrganizationSlug(headers({ host: "internal", "x-forwarded-host": "sur.sinipro.com" }))).toBe("sur");
  });

  it("ignores localhost and www without header", () => {
    expect(resolveOrganizationSlug(headers({ host: "localhost:3001" }))).toBeNull();
    expect(resolveOrganizationSlug(headers({ host: "www.sinipro.com" }))).toBeNull();
  });
});

describe("authenticate", () => {
  it("rejects a missing or non-bearer authorization header", async () => {
    const { supabase } = fakeSupabase({});
    await expect(authenticate(headers({}), supabase)).rejects.toMatchObject({
      status: 401,
      body: { message: "Missing bearer token" }
    });
    await expect(authenticate(headers({ authorization: "Basic good" }), supabase)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token Supabase does not accept", async () => {
    const { supabase } = fakeSupabase({ user: { id: "user-1" } });
    await expect(authenticate(headers({ authorization: "Bearer bad" }), supabase)).rejects.toMatchObject({
      status: 401,
      body: { message: "Invalid bearer token" }
    });
  });

  it("rejects inactive or missing profiles", async () => {
    const inactive = fakeSupabase({
      user: { id: "user-1" },
      tables: { user_profiles: { data: { ...profileRow, is_active: false }, error: null } }
    });
    await expect(authenticate(headers({ authorization: "Bearer good" }), inactive.supabase)).rejects.toMatchObject({
      status: 401,
      body: { message: "Inactive or missing profile" }
    });

    const missing = fakeSupabase({ user: { id: "user-1" } });
    await expect(authenticate(headers({ authorization: "Bearer good" }), missing.supabase)).rejects.toMatchObject({ status: 401 });
  });

  it("returns the active profile of the token owner", async () => {
    const { supabase, filters } = fakeSupabase({
      user: { id: "user-1" },
      tables: { user_profiles: { data: profileRow, error: null } }
    });

    await expect(authenticate(headers({ authorization: "Bearer good" }), supabase)).resolves.toEqual(user);
    expect(filters).toContainEqual(["user_profiles", "id", "user-1"]);
  });
});

describe("resolveOrganization", () => {
  it("requires an organization slug", async () => {
    const { supabase } = fakeSupabase({});
    await expect(resolveOrganization(headers({ host: "localhost" }), user, supabase)).rejects.toMatchObject({
      status: 403,
      body: { message: "Organization slug is required" }
    });
  });

  it("rejects users without an active membership in an active organization", async () => {
    const { supabase, filters } = fakeSupabase({});
    await expect(
      resolveOrganization(headers({ "x-organization-slug": "norte" }), user, supabase)
    ).rejects.toMatchObject({ status: 403, body: { message: "User has no access to this organization" } });
    expect(filters).toEqual([
      ["organization_memberships", "user_id", "user-1"],
      ["organization_memberships", "is_active", true],
      ["organization_memberships", "organizations.slug", "norte"],
      ["organization_memberships", "organizations.status", "active"]
    ]);
  });

  it("returns the organization with the membership role", async () => {
    const { supabase } = fakeSupabase({
      tables: { organization_memberships: { data: { role: "asesor", is_active: true, organizations: orgRow }, error: null } }
    });

    await expect(resolveOrganization(headers({ "x-organization-slug": "norte" }), user, supabase)).resolves.toEqual({
      id: "org-1",
      slug: "norte",
      displayName: "Norte",
      primaryColor: "#000",
      secondaryColor: null,
      role: "asesor"
    });
  });

  it("lets platform admins into any active organization without membership", async () => {
    const admin: AuthUser = { ...user, platformRole: "platform_admin" };
    const { supabase, filters } = fakeSupabase({ tables: { organizations: { data: orgRow, error: null } } });

    await expect(resolveOrganization(headers({ "x-organization-slug": "norte" }), admin, supabase)).resolves.toMatchObject({
      id: "org-1",
      role: "platform_admin"
    });
    expect(filters).toEqual([
      ["organizations", "slug", "norte"],
      ["organizations", "status", "active"]
    ]);
  });

  it("rejects platform admins for unknown or inactive organizations", async () => {
    const admin: AuthUser = { ...user, platformRole: "platform_admin" };
    const { supabase } = fakeSupabase({});
    await expect(resolveOrganization(headers({ "x-organization-slug": "norte" }), admin, supabase)).rejects.toMatchObject({
      status: 403,
      body: { message: "Organization not found" }
    });
  });
});
