import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { BadRequestException, ForbiddenException } from "@/server/core/http-errors";
import type { SupabaseService } from "@/server/core/supabase";
import { OrganizationsService } from "@/server/modules/organizations/service";

// Cubre el takeover de cuentas desde Equipo: Supabase vive en memoria (tablas
// user_profiles y organization_memberships) y las llamadas a auth.admin se
// registran para comprobar que un rechazo no toca ni las tablas ni la auth.

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const PRODUCER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORPHAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STRANGER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NEW_USER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const OTHER_ORG_MESSAGE = "Ese usuario pertenece a otra organización y no puede gestionarse desde acá.";
const EXISTS_MESSAGE = "Ya existe un usuario con ese correo.";
const ADMIN_MESSAGE = "Ese usuario no puede gestionarse desde Equipo.";

const authUser: AuthUser = {
  id: PRODUCER,
  email: "productor@example.com",
  fullName: "Productor",
  avatarUrl: null,
  platformRole: "user"
};

const organization: OrganizationContext = {
  id: ORG,
  slug: "norte",
  displayName: "Norte",
  primaryColor: null,
  secondaryColor: null,
  role: "productor"
};

type Row = Record<string, unknown>;

function createFakeSupabase() {
  const userProfiles: Row[] = [];
  const memberships: Row[] = [];
  const tables: Record<string, Row[]> = { user_profiles: userProfiles, organization_memberships: memberships };
  const adminCalls: Array<{ method: string; args: unknown[] }> = [];
  const signOuts: unknown[][] = [];
  let sequence = 0;

  class Query {
    private op: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Row = {};
    private conflict: string[] = [];
    private filters: Array<(row: Row) => boolean> = [];
    private limitTo: number | null = null;
    private head = false;
    private columns = "";

    constructor(private readonly table: string) {}

    select(columns?: string, options?: { count?: string; head?: boolean }) {
      this.columns = columns ?? this.columns;
      this.head = Boolean(options?.head);
      return this;
    }
    insert(payload: Row) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    update(payload: Row) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    upsert(payload: Row, options: { onConflict: string }) {
      this.op = "upsert";
      this.payload = payload;
      this.conflict = options.onConflict.split(",");
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value);
      return this;
    }
    neq(column: string, value: unknown) {
      this.filters.push((row) => row[column] !== value);
      return this;
    }
    limit(count: number) {
      this.limitTo = count;
      return this;
    }
    maybeSingle() {
      return this;
    }
    returns() {
      return this;
    }

    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.run()).then(resolve, reject);
    }

    // El join `user_profiles(...)` se resuelve contra la tabla en memoria.
    private project(row: Row): Row {
      if (this.table === "organization_memberships" && this.columns.includes("user_profiles(")) {
        const profile = userProfiles.find((candidate) => candidate.id === row.user_id) ?? null;
        return { ...row, user_profiles: profile ? { ...profile } : null };
      }
      return { ...row };
    }

    private run() {
      const rows = tables[this.table] as Row[];
      const matches = () => rows.filter((row) => this.filters.every((filter) => filter(row)));
      let affected: Row[];

      if (this.op === "insert") {
        const created = { id: `${this.table}-${++sequence}`, created_at: "2026-10-28T00:00:00Z", ...this.payload };
        rows.push(created);
        affected = [created];
      } else if (this.op === "upsert") {
        const existing = rows.find((row) => this.conflict.every((column) => row[column] === this.payload[column]));
        if (existing) {
          Object.assign(existing, this.payload);
          affected = [existing];
        } else {
          const created = { id: `${this.table}-${++sequence}`, created_at: "2026-10-28T00:00:00Z", ...this.payload };
          rows.push(created);
          affected = [created];
        }
      } else if (this.op === "update") {
        affected = matches();
        for (const row of affected) Object.assign(row, this.payload);
      } else {
        affected = matches();
      }

      if (this.limitTo !== null) affected = affected.slice(0, this.limitTo);
      if (this.head) return { data: null, error: null, count: affected.length };
      const projected = affected.map((row) => this.project(row));
      return { data: projected[0] ?? null, error: null, count: affected.length };
    }
  }

  const record = (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      adminCalls.push({ method, args });
      return result;
    };

  const client = {
    admin: {
      from: (table: string) => new Query(table),
      auth: {
        admin: {
          createUser: record("createUser", { data: { user: { id: NEW_USER } }, error: null }),
          updateUserById: record("updateUserById", { data: {}, error: null }),
          deleteUser: record("deleteUser", { data: {}, error: null }),
          // La verificación del productor revoca su sesión: no es una mutación de cuentas.
          signOut: async (...args: unknown[]) => {
            signOuts.push(args);
            return { error: null };
          }
        }
      }
    },
    publicAuth: {
      auth: {
        signInWithPassword: async () => ({ data: { session: { access_token: "token" } }, error: null })
      }
    }
  };

  return {
    supabase: client as unknown as SupabaseService,
    userProfiles,
    memberships,
    adminCalls,
    signOuts,
    snapshot: () => JSON.stringify([userProfiles, memberships])
  };
}

type Fake = ReturnType<typeof createFakeSupabase>;

function addProfile(fake: Fake, id: string, email: string, platformRole = "user") {
  fake.userProfiles.push({
    id,
    email,
    full_name: email.split("@")[0],
    platform_role: platformRole,
    is_active: true
  });
}

function addMembership(fake: Fake, userId: string, organizationId: string, isActive = true, role = "asesor") {
  const id = `membership-${userId.slice(0, 4)}-${organizationId.slice(0, 4)}`;
  fake.memberships.push({
    id,
    organization_id: organizationId,
    user_id: userId,
    role,
    is_active: isActive,
    created_at: "2026-01-01T00:00:00Z"
  });
  return id;
}

const createDto = (email: string) => ({ fullName: "Nuevo Integrante", email, role: "asesor" as const, password: "password-123" });
const updateDto = (email: string) => ({ fullName: "Editado", email, role: "asesor" as const, producerPassword: "productor-pass" });
const passwordDto = { password: "nueva-password-1", producerPassword: "productor-pass" };

describe("OrganizationsService team management", () => {
  let fake: Fake;
  let service: OrganizationsService;

  beforeEach(() => {
    fake = createFakeSupabase();
    service = new OrganizationsService(fake.supabase);
    addProfile(fake, PRODUCER, "productor@example.com");
    addMembership(fake, PRODUCER, ORG, true, "productor");
  });

  // Ejecuta la acción esperando un rechazo y comprueba que no cambió nada.
  async function expectRejected(action: () => Promise<unknown>, type: new (...args: never[]) => Error, message: string) {
    const before = fake.snapshot();
    const error = await action().then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(type);
    expect((error as Error).message).toBe(message);
    expect(fake.adminCalls).toEqual([]);
    expect(fake.snapshot()).toBe(before);
  }

  describe("createTeamMember", () => {
    it("creates auth user, profile and membership for a brand-new email", async () => {
      const result = await service.createTeamMember(organization, createDto("nuevo@example.com"));

      expect(fake.adminCalls.map((call) => call.method)).toEqual(["createUser"]);
      expect(fake.userProfiles.find((row) => row.email === "nuevo@example.com")).toMatchObject({
        id: NEW_USER,
        platform_role: "user"
      });
      expect(fake.memberships).toContainEqual(
        expect.objectContaining({ organization_id: ORG, user_id: NEW_USER, role: "asesor", is_active: true })
      );
      expect(result).toMatchObject({ userId: NEW_USER, email: "nuevo@example.com", isActive: true });
    });

    it("re-adds a former member of this organization and reactivates the membership", async () => {
      addProfile(fake, ORPHAN, "ex@example.com");
      addMembership(fake, ORPHAN, ORG, false);

      const result = await service.createTeamMember(organization, createDto("ex@example.com"));

      expect(fake.adminCalls).toEqual([]);
      expect(fake.memberships.filter((row) => row.user_id === ORPHAN)).toEqual([
        expect.objectContaining({ organization_id: ORG, is_active: true, role: "asesor" })
      ]);
      expect(result).toMatchObject({ userId: ORPHAN, isActive: true });
    });

    it("refuses an existing email with no membership at all", async () => {
      addProfile(fake, STRANGER, "suelto@example.com");

      await expectRejected(
        () => service.createTeamMember(organization, createDto("suelto@example.com")),
        BadRequestException,
        EXISTS_MESSAGE
      );
    });

    it("refuses an orphan whose only membership is inactive in another organization", async () => {
      addProfile(fake, ORPHAN, "ex@example.com");
      addMembership(fake, ORPHAN, OTHER_ORG, false);

      await expectRejected(
        () => service.createTeamMember(organization, createDto("ex@example.com")),
        BadRequestException,
        EXISTS_MESSAGE
      );
    });

    it("refuses an existing user active in another organization", async () => {
      addProfile(fake, STRANGER, "otro@example.com");
      addMembership(fake, STRANGER, OTHER_ORG, true);

      await expectRejected(
        () => service.createTeamMember(organization, createDto("otro@example.com")),
        BadRequestException,
        EXISTS_MESSAGE
      );
    });

    it("refuses a former member of this organization that also belongs to another one", async () => {
      addProfile(fake, ORPHAN, "doble@example.com");
      addMembership(fake, ORPHAN, ORG, false);
      addMembership(fake, ORPHAN, OTHER_ORG, false);

      await expectRejected(
        () => service.createTeamMember(organization, createDto("doble@example.com")),
        ForbiddenException,
        OTHER_ORG_MESSAGE
      );
    });

    it("never adds a platform admin without memberships", async () => {
      addProfile(fake, ADMIN, "admin@example.com", "platform_admin");

      await expectRejected(
        () => service.createTeamMember(organization, createDto("admin@example.com")),
        ForbiddenException,
        ADMIN_MESSAGE
      );
    });

    it("never re-adds a platform admin even with a membership in this organization", async () => {
      addProfile(fake, ADMIN, "admin@example.com", "platform_admin");
      addMembership(fake, ADMIN, ORG, false);

      await expectRejected(
        () => service.createTeamMember(organization, createDto("admin@example.com")),
        ForbiddenException,
        ADMIN_MESSAGE
      );
    });
  });

  describe("updateTeamMember", () => {
    it("edits a normal member that belongs only to this organization", async () => {
      addProfile(fake, MEMBER, "miembro@example.com");
      const membershipId = addMembership(fake, MEMBER, ORG);

      const result = await service.updateTeamMember(authUser, organization, membershipId, updateDto("nuevo-mail@example.com"));

      expect(fake.adminCalls.map((call) => call.method)).toEqual(["updateUserById"]);
      expect(fake.adminCalls[0]?.args[0]).toBe(MEMBER);
      expect(fake.userProfiles.find((row) => row.id === MEMBER)).toMatchObject({
        email: "nuevo-mail@example.com",
        full_name: "Editado"
      });
      expect(result).toMatchObject({ userId: MEMBER, email: "nuevo-mail@example.com" });
    });

    it("refuses a platform admin that has a membership in this organization", async () => {
      addProfile(fake, ADMIN, "admin@example.com", "platform_admin");
      const membershipId = addMembership(fake, ADMIN, ORG);

      await expectRejected(
        () => service.updateTeamMember(authUser, organization, membershipId, updateDto("hijack@example.com")),
        ForbiddenException,
        ADMIN_MESSAGE
      );
    });

    it("refuses a member with an inactive membership in another organization", async () => {
      addProfile(fake, ORPHAN, "ex@example.com");
      const membershipId = addMembership(fake, ORPHAN, ORG);
      addMembership(fake, ORPHAN, OTHER_ORG, false);

      await expectRejected(
        () => service.updateTeamMember(authUser, organization, membershipId, updateDto("hijack@example.com")),
        ForbiddenException,
        OTHER_ORG_MESSAGE
      );
    });

    it("refuses a member with an active membership in another organization", async () => {
      addProfile(fake, STRANGER, "otro@example.com");
      const membershipId = addMembership(fake, STRANGER, ORG);
      addMembership(fake, STRANGER, OTHER_ORG, true);

      await expectRejected(
        () => service.updateTeamMember(authUser, organization, membershipId, updateDto("hijack@example.com")),
        ForbiddenException,
        OTHER_ORG_MESSAGE
      );
    });
  });

  describe("changeTeamMemberPassword", () => {
    it("changes the password of a normal member that belongs only to this organization", async () => {
      addProfile(fake, MEMBER, "miembro@example.com");
      const membershipId = addMembership(fake, MEMBER, ORG);

      const result = await service.changeTeamMemberPassword(authUser, organization, membershipId, passwordDto);

      expect(fake.adminCalls).toEqual([{ method: "updateUserById", args: [MEMBER, { password: "nueva-password-1" }] }]);
      expect(result).toMatchObject({ userId: MEMBER });
    });

    it("refuses a platform admin that has a membership in this organization", async () => {
      addProfile(fake, ADMIN, "admin@example.com", "platform_admin");
      const membershipId = addMembership(fake, ADMIN, ORG);

      await expectRejected(
        () => service.changeTeamMemberPassword(authUser, organization, membershipId, passwordDto),
        ForbiddenException,
        ADMIN_MESSAGE
      );
    });

    it("refuses a member with an inactive membership in another organization", async () => {
      addProfile(fake, ORPHAN, "ex@example.com");
      const membershipId = addMembership(fake, ORPHAN, ORG);
      addMembership(fake, ORPHAN, OTHER_ORG, false);

      await expectRejected(
        () => service.changeTeamMemberPassword(authUser, organization, membershipId, passwordDto),
        ForbiddenException,
        OTHER_ORG_MESSAGE
      );
    });

    it("refuses a member with an active membership in another organization", async () => {
      addProfile(fake, STRANGER, "otro@example.com");
      const membershipId = addMembership(fake, STRANGER, ORG);
      addMembership(fake, STRANGER, OTHER_ORG, true);

      await expectRejected(
        () => service.changeTeamMemberPassword(authUser, organization, membershipId, passwordDto),
        ForbiddenException,
        OTHER_ORG_MESSAGE
      );
    });
  });
});
