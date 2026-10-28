import "server-only";
import { UnauthorizedException } from "@/server/core/http-errors";
import type { SupabaseService } from "@/server/core/supabase";
import type { LoginDto, RefreshDto } from "./schemas";

type MembershipRow = {
  organization_id: string;
  role: string;
};

type OrganizationRow = {
  id: string;
  slug: string;
  display_name: string;
  logo_url: string | null;
  login_logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  status: string;
};

export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async login(dto: LoginDto) {
    const { data: authData, error } =
      await this.supabase.publicAuth.auth.signInWithPassword({
        email: dto.email,
        password: dto.password
      });

    if (error || !authData.session || !authData.user.email) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.buildAuthState(authData.session.access_token, authData.session.refresh_token, authData.session.expires_at ?? null);
  }

  async refresh(dto: RefreshDto) {
    const { data, error } = await this.supabase.publicAuth.auth.refreshSession({
      refresh_token: dto.refreshToken
    });

    if (error || !data.session) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    return this.buildAuthState(data.session.access_token, data.session.refresh_token, data.session.expires_at ?? null);
  }

  private async buildAuthState(accessToken: string, refreshToken: string, expiresAt: number | null) {
    const { data: authData, error: authError } = await this.supabase.admin.auth.getUser(accessToken);
    if (authError || !authData.user?.id) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const { data: profile, error: profileError } = await this.supabase.admin
      .from("user_profiles")
      .select("id,email,full_name,avatar_url,platform_role,is_active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile?.is_active) {
      throw new UnauthorizedException("User profile is inactive or missing");
    }

    const { data: memberships } = await this.supabase.admin
      .from("organization_memberships")
      .select("organization_id,role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .returns<MembershipRow[]>();

    const organizationIds = (memberships ?? []).map(
      (membership) => membership.organization_id
    );

    const { data: organizations } = organizationIds.length
      ? await this.supabase.admin
          .from("organizations")
          .select("id,slug,display_name,logo_url,login_logo_url,primary_color,secondary_color,status")
          .in("id", organizationIds)
          .eq("status", "active")
          .returns<OrganizationRow[]>()
      : { data: [] as OrganizationRow[] };

    const organizationsById = new Map(
      (organizations ?? []).map((organization) => [organization.id, organization])
    );

    return {
      accessToken,
      refreshToken,
      expiresAt,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        avatarUrl: profile.avatar_url,
        platformRole: profile.platform_role
      },
      organizations: (memberships ?? [])
        .map((membership) => {
          const organization = organizationsById.get(membership.organization_id);
          if (!organization) {
            return null;
          }

          return {
            id: organization.id,
            slug: organization.slug,
            displayName: organization.display_name,
            logoUrl: organization.logo_url,
            loginLogoUrl: organization.login_logo_url,
            primaryColor: organization.primary_color,
            secondaryColor: organization.secondary_color,
            role: membership.role
          };
        })
        .filter((organization) => organization !== null)
    };
  }
}
