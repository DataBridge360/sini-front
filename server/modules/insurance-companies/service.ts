import "server-only";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import type { CreateInsuranceCompanyDto } from "./schemas";

export class InsuranceCompaniesService {
  private readonly logger = new Logger("InsuranceCompaniesService");

  constructor(private readonly supabase: SupabaseService) {}

  async findAll(organizationId: string) {
    const { data, error } = await this.supabase.admin
      .from("insurance_companies")
      .select("id,name,is_active,created_at")
      .eq("organization_id", organizationId)
      .order("name");

    if (error) {
      throw supabaseError(this.logger, "insuranceCompanies.findAll", error, "No se pudieron obtener las compañías.");
    }

    return data ?? [];
  }

  async create(organizationId: string, dto: CreateInsuranceCompanyDto) {
    const { data, error } = await this.supabase.admin
      .from("insurance_companies")
      .insert({ organization_id: organizationId, name: dto.name })
      .select("id,name,is_active,created_at")
      .single();

    if (error) {
      throw supabaseError(this.logger, "insuranceCompanies.create", error, "No se pudo crear la compañía.");
    }

    return data;
  }
}
