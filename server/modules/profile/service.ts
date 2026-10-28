import "server-only";
import type { AuthUser } from "@/server/core/context";
import { UnauthorizedException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import type { ChangePasswordDto, UpdateProfileDto } from "./schemas";

export class ProfileService {
  private readonly logger = new Logger("ProfileService");

  constructor(private readonly supabase: SupabaseService) {}

  async getProfile(user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from("user_profiles")
      .select("id,email,full_name,avatar_url,platform_role,is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (error || !data?.is_active) {
      throw new UnauthorizedException("Inactive or missing profile");
    }

    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      avatarUrl: data.avatar_url,
      platformRole: data.platform_role
    };
  }

  async updateProfile(user: AuthUser, dto: UpdateProfileDto) {
    const { data, error } = await this.supabase.admin
      .from("user_profiles")
      .update({
        full_name: dto.fullName,
        avatar_url: dto.avatarUrl === "" ? null : dto.avatarUrl ?? null
      })
      .eq("id", user.id)
      .select("id,email,full_name,avatar_url,platform_role")
      .single();

    if (error) {
      throw supabaseError(this.logger, "profile.updateProfile", error, "No se pudo actualizar el perfil.");
    }

    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      avatarUrl: data.avatar_url,
      platformRole: data.platform_role
    };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const { data: verifyData, error: verifyError } = await this.supabase.publicAuth.auth.signInWithPassword({
      email: user.email,
      password: dto.currentPassword
    });

    if (verifyError) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    // La verificación emite una sesión real: se revoca para no dejarla huérfana.
    // Best effort: si la revocación falla, la sesión expira sola por TTL.
    if (verifyData.session?.access_token) {
      await this.supabase.admin.auth.admin.signOut(verifyData.session.access_token, "local");
    }

    const { error } = await this.supabase.admin.auth.admin.updateUserById(user.id, {
      password: dto.newPassword
    });

    if (error) {
      throw supabaseError(this.logger, "profile.changePassword", error, "No se pudo cambiar la contraseña.");
    }

    return { ok: true };
  }
}
