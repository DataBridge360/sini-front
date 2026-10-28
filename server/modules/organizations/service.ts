import "server-only";
import type { AuthUser, OrganizationContext, OrganizationRole } from "@/server/core/context";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException
} from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import type {
  ChangeOrganizationTeamMemberPasswordDto,
  CreateOrganizationTeamMemberDto,
  DeactivateOrganizationTeamMemberDto,
  UpdateOrganizationDto,
  UpdateOrganizationTeamMemberDto
} from "./schemas";

type UploadedLogoFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

type TeamMemberProfile = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  platform_role?: string;
};

type TeamMembershipRecord = {
  id: string;
  user_id: string;
  role: OrganizationRole;
  is_active: boolean;
  created_at: string;
  user_profiles: TeamMemberProfile | TeamMemberProfile[] | null;
};

export class OrganizationsService {
  private readonly logger = new Logger("OrganizationsService");

  constructor(private readonly supabase: SupabaseService) {}

  private readonly logoBucket = "organization-logos";
  private readonly logoMimeTypes = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"]
  ]);

  // Debe coincidir con el file_size_limit del bucket organization-logos (2MB).
  private readonly logoMaxSizeBytes = 2_000_000;

  private readonly currentSelect =
    "id,slug,display_name,login_logo_url,logo_url,primary_color,secondary_color,support_email,support_phone,status";

  async getPublicBySlug(slug: string) {
    const { data, error } = await this.supabase.admin
      .from("organizations")
      .select("slug,display_name,login_logo_url,logo_url,primary_color,secondary_color,support_email,support_phone,status")
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException("Organization not found");
    }

    // Public endpoint: keep the PublicOrganization shape but never expose contact data.
    return {
      ...data,
      support_email: null,
      support_phone: null
    };
  }

  async getCurrent(organizationId: string) {
    const { data, error } = await this.supabase.admin
      .from("organizations")
      .select(this.currentSelect)
      .eq("id", organizationId)
      .eq("status", "active")
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException("Organization not found");
    }

    return data;
  }

  async updateCurrent(organization: OrganizationContext, dto: UpdateOrganizationDto) {
    if (organization.role !== "productor" && organization.role !== "platform_admin") {
      throw new ForbiddenException("Only producers can update organization settings");
    }

    const { data, error } = await this.supabase.admin
      .from("organizations")
      .update({
        display_name: dto.displayName,
        logo_url: dto.logoUrl ?? null,
        primary_color: dto.primaryColor ?? null,
        secondary_color: dto.secondaryColor ?? null,
        support_email: dto.supportEmail ?? null,
        support_phone: dto.supportPhone ?? null
      })
      .eq("id", organization.id)
      .eq("status", "active")
      .select(this.currentSelect)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException("Organization not found");
    }

    return data;
  }

  async listTeam(organization: OrganizationContext) {
    this.assertCanManageTeam(organization);

    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id,user_id,role,is_active,created_at,user_profiles(id,email,full_name,is_active)")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: true })
      .returns<TeamMembershipRecord[]>();

    if (error) {
      throw supabaseError(this.logger, "organizations.listTeam", error, "No se pudo obtener el equipo.");
    }

    return (data ?? []).map((membership) => {
      const profile = Array.isArray(membership.user_profiles)
        ? membership.user_profiles[0]
        : membership.user_profiles;

      return {
        id: membership.id,
        userId: membership.user_id,
        fullName: profile?.full_name ?? "Usuario sin perfil",
        email: profile?.email ?? "",
        role: membership.role,
        isActive: membership.is_active && Boolean(profile?.is_active),
        createdAt: membership.created_at
      };
    });
  }

  async listMembers(organization: OrganizationContext) {
    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("user_id,user_profiles(id,full_name,is_active)")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .returns<Array<Pick<TeamMembershipRecord, "user_id" | "user_profiles">>>();

    if (error) {
      throw supabaseError(this.logger, "organizations.listMembers", error, "No se pudieron obtener los miembros.");
    }

    return (data ?? [])
      .map((membership) => {
        const profile = this.getMembershipProfile(membership);
        if (!profile?.is_active) return null;
        return { id: membership.user_id, full_name: profile.full_name };
      })
      .filter((member): member is { id: string; full_name: string } => member !== null)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"));
  }

  async createTeamMember(organization: OrganizationContext, dto: CreateOrganizationTeamMemberDto) {
    this.assertCanManageTeam(organization);

    const email = dto.email.toLowerCase();
    let profile = await this.findProfileByEmail(email);
    let createdAuthUserId: string | null = null;

    if (profile) {
      // Un correo existente solo se reutiliza si es un ex integrante de ESTA
      // organización (membresía activa o inactiva). Cualquier otro perfil no se
      // toca: evita el takeover de cuentas ajenas, de admins o de otras orgs.
      this.assertNotPlatformAdmin(profile);
      if (!(await this.hasMembershipIn(organization.id, profile.id))) {
        throw new BadRequestException("Ya existe un usuario con ese correo.");
      }
      await this.assertUserBelongsOnlyToOrganization(organization.id, profile);
    }

    if (!profile) {
      const { data: authData, error: authError } =
        await this.supabase.admin.auth.admin.createUser({
          email,
          password: dto.password,
          email_confirm: true,
          user_metadata: {
            full_name: dto.fullName
          },
          app_metadata: {
            organization_role: dto.role
          }
        });

      if (authError || !authData.user?.id) {
        if (authError?.code === "email_exists") {
          throw new BadRequestException("Ya existe un usuario con ese correo.");
        }
        throw supabaseError(this.logger, "organizations.createTeamMember.auth", authError, "No se pudo crear el usuario.");
      }

      createdAuthUserId = authData.user.id;

      const { data: createdProfile, error: profileError } = await this.supabase.admin
        .from("user_profiles")
        .insert({
          id: authData.user.id,
          email,
          full_name: dto.fullName,
          platform_role: "user",
          is_active: true
        })
        .select("id,email,full_name,is_active")
        .maybeSingle();

      if (profileError || !createdProfile) {
        await this.supabase.admin.auth.admin.deleteUser(authData.user.id);
        throw supabaseError(this.logger, "organizations.createTeamMember.profile", profileError, "No se pudo crear el perfil.");
      }

      profile = createdProfile;
    }

    const { data: membership, error: membershipError } = await this.supabase.admin
      .from("organization_memberships")
      .upsert(
        {
          organization_id: organization.id,
          user_id: profile.id,
          role: dto.role,
          is_active: true
        },
        { onConflict: "organization_id,user_id" }
      )
      .select("id,role,is_active,created_at")
      .maybeSingle();

    if (membershipError || !membership) {
      if (createdAuthUserId) {
        await this.supabase.admin.auth.admin.deleteUser(createdAuthUserId);
      }
      throw supabaseError(this.logger, "organizations.createTeamMember.membership", membershipError, "No se pudo agregar el usuario al equipo.");
    }

    return {
      id: membership.id,
      userId: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      role: membership.role,
      isActive: membership.is_active && profile.is_active,
      createdAt: membership.created_at
    };
  }

  async updateTeamMember(
    user: AuthUser,
    organization: OrganizationContext,
    membershipId: string,
    dto: UpdateOrganizationTeamMemberDto
  ) {
    this.assertCanManageTeam(organization);
    await this.verifyProducerPassword(user, dto.producerPassword);

    const membership = await this.getTeamMembership(organization.id, membershipId);
    if (!membership.is_active) {
      throw new BadRequestException("El integrante ya no está activo");
    }
    if (membership.user_id === user.id) {
      throw new BadRequestException("No podés editar tu propio usuario desde Equipo");
    }
    const profile = this.getMembershipProfile(membership);
    if (!profile) {
      throw new NotFoundException("Team member profile not found");
    }
    // El cambio de email afecta la cuenta global del usuario: solo se permite si
    // el usuario pertenece exclusivamente a esta organización.
    await this.assertUserBelongsOnlyToOrganization(organization.id, profile);

    if (membership.role === "productor" && dto.role !== "productor") {
      await this.assertNotLastActiveProducer(organization.id, membership.id);
    }

    const existingProfile = await this.findProfileByEmail(dto.email);
    if (existingProfile && existingProfile.id !== membership.user_id) {
      throw new BadRequestException("Ya existe un usuario con ese correo");
    }

    const { error: authError } = await this.supabase.admin.auth.admin.updateUserById(
      membership.user_id,
      {
        email: dto.email,
        email_confirm: true,
        user_metadata: {
          full_name: dto.fullName
        }
      }
    );

    if (authError) {
      throw supabaseError(this.logger, "organizations.updateTeamMember.auth", authError, "No se pudo actualizar el integrante.");
    }

    const { error: profileError } = await this.supabase.admin
      .from("user_profiles")
      .update({
        full_name: dto.fullName,
        email: dto.email,
        is_active: true
      })
      .eq("id", membership.user_id);

    if (profileError) {
      throw supabaseError(this.logger, "organizations.updateTeamMember.profile", profileError, "No se pudo actualizar el integrante.");
    }

    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .update({
        role: dto.role,
        is_active: true
      })
      .eq("id", membership.id)
      .eq("organization_id", organization.id)
      .select("id,user_id,role,is_active,created_at,user_profiles(id,email,full_name,is_active)")
      .maybeSingle<TeamMembershipRecord>();

    if (error || !data) {
      throw supabaseError(this.logger, "organizations.updateTeamMember.membership", error, "No se pudo actualizar el integrante.");
    }

    return this.serializeTeamMembership(data);
  }

  async changeTeamMemberPassword(
    user: AuthUser,
    organization: OrganizationContext,
    membershipId: string,
    dto: ChangeOrganizationTeamMemberPasswordDto
  ) {
    this.assertCanManageTeam(organization);
    await this.verifyProducerPassword(user, dto.producerPassword);

    const membership = await this.getTeamMembership(organization.id, membershipId);
    if (!membership.is_active) {
      throw new BadRequestException("El integrante ya no está activo");
    }
    if (membership.user_id === user.id) {
      throw new BadRequestException("No podés cambiar tu propia contraseña desde Equipo");
    }
    const profile = this.getMembershipProfile(membership);
    if (!profile) {
      throw new NotFoundException("Team member profile not found");
    }
    // La contraseña es de la cuenta global del usuario: solo se permite si el
    // usuario pertenece exclusivamente a esta organización.
    await this.assertUserBelongsOnlyToOrganization(organization.id, profile);

    const { error } = await this.supabase.admin.auth.admin.updateUserById(
      membership.user_id,
      { password: dto.password }
    );

    if (error) {
      throw supabaseError(this.logger, "organizations.changeTeamMemberPassword", error, "No se pudo cambiar la contraseña.");
    }

    return this.serializeTeamMembership(membership);
  }

  async deactivateTeamMember(
    user: AuthUser,
    organization: OrganizationContext,
    membershipId: string,
    dto: DeactivateOrganizationTeamMemberDto
  ) {
    this.assertCanManageTeam(organization);
    await this.verifyProducerPassword(user, dto.producerPassword);

    const membership = await this.getTeamMembership(organization.id, membershipId);
    if (membership.user_id === user.id) {
      throw new BadRequestException("No podés eliminar tu propio acceso");
    }
    if (membership.role === "productor") {
      await this.assertNotLastActiveProducer(organization.id, membership.id);
    }

    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .update({ is_active: false })
      .eq("id", membership.id)
      .eq("organization_id", organization.id)
      .select("id,user_id,role,is_active,created_at,user_profiles(id,email,full_name,is_active)")
      .maybeSingle<TeamMembershipRecord>();

    if (error || !data) {
      throw supabaseError(this.logger, "organizations.deactivateTeamMember", error, "No se pudo eliminar el integrante.");
    }

    return this.serializeTeamMembership(data);
  }

  async uploadLogo(
    organization: OrganizationContext,
    kind: "main" | "login",
    file: UploadedLogoFile | undefined
  ) {
    if (organization.role !== "productor" && organization.role !== "platform_admin") {
      throw new ForbiddenException("Only producers can update organization settings");
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException("Logo image is required");
    }

    const extension = this.logoMimeTypes.get(file.mimetype);
    if (!extension) {
      throw new BadRequestException("Logo must be a PNG, JPG, WEBP or GIF image");
    }

    if (file.size > this.logoMaxSizeBytes) {
      throw new BadRequestException("El logo debe pesar 2 MB o menos");
    }

    const safeBaseName = file.originalname
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "logo";
    const path = `${organization.id}/${kind}-${Date.now()}-${safeBaseName}.${extension}`;

    const { error } = await this.supabase.admin.storage
      .from(this.logoBucket)
      .upload(path, file.buffer, {
        cacheControl: "31536000",
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      throw supabaseError(this.logger, "organizations.uploadLogo.storage", error, "No se pudo subir el logo.");
    }

    const { data } = this.supabase.admin.storage.from(this.logoBucket).getPublicUrl(path);
    const column = kind === "login" ? "login_logo_url" : "logo_url";

    const { data: organizationData, error: updateError } = await this.supabase.admin
      .from("organizations")
      .update({ [column]: data.publicUrl })
      .eq("id", organization.id)
      .eq("status", "active")
      .select(this.currentSelect)
      .maybeSingle();

    if (updateError || !organizationData) {
      throw supabaseError(this.logger, "organizations.uploadLogo.update", updateError, "Se subió el logo pero no se pudo actualizar la organización.");
    }

    return { url: data.publicUrl, organization: organizationData };
  }

  private assertCanManageTeam(organization: OrganizationContext) {
    if (organization.role !== "productor" && organization.role !== "platform_admin") {
      throw new ForbiddenException("Only producers can manage organization team");
    }
  }

  private async verifyProducerPassword(user: AuthUser, password: string) {
    const { data, error } = await this.supabase.publicAuth.auth.signInWithPassword({
      email: user.email,
      password
    });

    if (error) {
      throw new UnauthorizedException("La contraseña del productor no es válida");
    }

    // La verificación emite una sesión real: se revoca para no dejarla huérfana.
    // Best effort: si la revocación falla, la sesión expira sola por TTL.
    if (data.session?.access_token) {
      await this.supabase.admin.auth.admin.signOut(data.session.access_token, "local");
    }
  }

  private async getTeamMembership(organizationId: string, membershipId: string) {
    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id,user_id,role,is_active,created_at,user_profiles(id,email,full_name,is_active,platform_role)")
      .eq("id", membershipId)
      .eq("organization_id", organizationId)
      .maybeSingle<TeamMembershipRecord>();

    if (error || !data) {
      throw new NotFoundException("Team member not found");
    }

    return data;
  }

  private getMembershipProfile(membership: Pick<TeamMembershipRecord, "user_profiles">) {
    return Array.isArray(membership.user_profiles)
      ? membership.user_profiles[0]
      : membership.user_profiles;
  }

  private serializeTeamMembership(membership: TeamMembershipRecord) {
    const profile = this.getMembershipProfile(membership);
    return {
      id: membership.id,
      userId: membership.user_id,
      fullName: profile?.full_name ?? "Usuario sin perfil",
      email: profile?.email ?? "",
      role: membership.role,
      isActive: membership.is_active && Boolean(profile?.is_active),
      createdAt: membership.created_at
    };
  }

  // Los admins de plataforma nunca se gestionan desde Equipo (pueden no tener
  // membresías, así que ningún chequeo por organización los cubre).
  private assertNotPlatformAdmin(profile: TeamMemberProfile) {
    if (profile.platform_role === "platform_admin") {
      throw new ForbiddenException("Ese usuario no puede gestionarse desde Equipo.");
    }
  }

  private async hasMembershipIn(organizationId: string, userId: string) {
    const { count, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("organization_id", organizationId);

    if (error) {
      throw supabaseError(this.logger, "organizations.hasMembershipIn", error, "No se pudo validar el usuario.");
    }

    return Boolean(count);
  }

  private async assertUserBelongsOnlyToOrganization(organizationId: string, profile: TeamMemberProfile) {
    this.assertNotPlatformAdmin(profile);

    // Cuenta también las membresías inactivas: un ex empleado desactivado en otra
    // organización sigue siendo una cuenta ajena.
    const { count, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .neq("organization_id", organizationId);

    if (error) {
      throw supabaseError(this.logger, "organizations.assertUserBelongsOnlyToOrganization", error, "No se pudo validar el usuario.");
    }

    if (count) {
      throw new ForbiddenException("Ese usuario pertenece a otra organización y no puede gestionarse desde acá.");
    }
  }

  private async assertNotLastActiveProducer(organizationId: string, excludedMembershipId: string) {
    const { count, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "productor")
      .eq("is_active", true)
      .neq("id", excludedMembershipId);

    if (error) {
      throw supabaseError(this.logger, "organizations.assertNotLastActiveProducer", error, "No se pudo validar el equipo.");
    }

    if (!count) {
      throw new BadRequestException("La organización debe conservar al menos un productor activo");
    }
  }

  private async findProfileByEmail(email: string) {
    const { data, error } = await this.supabase.admin
      .from("user_profiles")
      .select("id,email,full_name,is_active,platform_role")
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "organizations.findProfileByEmail", error, "No se pudo verificar el correo.");
    }

    return data as TeamMemberProfile | null;
  }
}
