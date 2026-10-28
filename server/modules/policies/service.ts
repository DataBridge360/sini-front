import "server-only";
import { BadRequestException, NotFoundException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import {
  clampPage,
  PAGE_SIZE_DEFAULT,
  pageRange,
  type Paginated
} from "@/server/core/pagination";
import { escapeLikePattern, isIsoTimestamp, isUuid, pgrstQuote } from "@/server/core/postgrest";
import type { CreatePolicyDto, ListPoliciesQueryDto, UpdatePolicyDto } from "./schemas";

type PolicyCursor = { created_at: string; id: string };

const POLICY_SELECT =
  "id,branch,policy_number,vehicle_plate,payment_interval_months,payment_method,first_payment_date,is_active,created_at,clients!policies_client_fk(id,full_name),insurance_companies!policies_insurance_company_fk(id,name)";

const POLICY_NOTICE_SELECT =
  "id,due_date,status,paid_interval_months,notified_at,payment_processed_at,created_at,policies!policy_notices_policy_fk(id,policy_number,branch,vehicle_plate,clients!policies_client_fk(id,full_name,phone,email,notes),insurance_companies!policies_insurance_company_fk(id,name)),notified_by:user_profiles!policy_notices_notified_by_user_id_fkey(id,full_name),payment_processed_by:user_profiles!policy_notices_payment_processed_by_user_id_fkey(id,full_name),notes:notice_notes(id,note,created_at,user_id,user:user_profiles!notice_notes_user_id_fkey(id,full_name))";

export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findAll(
    organizationId: string,
    options: ListPoliciesQueryDto = {}
  ): Promise<{ data: unknown[]; nextCursor: string | null }> {
    const { limit } = options;

    let query = this.supabase.admin
      .from("policies")
      .select(POLICY_SELECT)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (limit) {
      const cursor = decodePolicyCursor(options.cursor);
      if (cursor) {
        query = query.or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
        );
      }
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "policies.findAll", error, "No se pudieron obtener las pólizas.");
    }

    const rows = (data ?? []) as Array<{ created_at: string; id: string }>;
    const last = rows[rows.length - 1];
    const nextCursor =
      limit && last && rows.length === limit ? encodePolicyCursor(last) : null;

    return { data: rows, nextCursor };
  }

  // Paginación numerada (PAGINADO.md): head-count con los mismos filtros para
  // acotar la página pedida, y después la página con los joins de siempre.
  async findPage(
    organizationId: string,
    options: ListPoliciesQueryDto
  ): Promise<Paginated<unknown>> {
    const pageSize = options.pageSize ?? PAGE_SIZE_DEFAULT;
    const orFilter = options.search
      ? await this.policySearchOrFilter(organizationId, options.search)
      : null;

    let countQuery = this.supabase.admin
      .from("policies")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (orFilter) countQuery = countQuery.or(orFilter);
    if (options.branch) countQuery = countQuery.eq("branch", options.branch);
    if (options.companyId) countQuery = countQuery.eq("insurance_company_id", options.companyId);

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw supabaseError(this.logger, "policies.findPage.count", countError, "No se pudieron obtener las pólizas.");
    }

    const total = count ?? 0;
    const page = clampPage(options.page ?? 1, pageSize, total);
    const { from, to } = pageRange(page, pageSize);

    let query = this.supabase.admin
      .from("policies")
      .select(POLICY_SELECT)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (orFilter) query = query.or(orFilter);
    if (options.branch) query = query.eq("branch", options.branch);
    if (options.companyId) query = query.eq("insurance_company_id", options.companyId);

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "policies.findPage", error, "No se pudieron obtener las pólizas.");
    }

    return { items: data ?? [], total, page, pageSize };
  }

  // Combobox (vincular póliza a una tarea): número + asegurado, acotado.
  async search(organizationId: string, term: string | null, limit: number) {
    let query = this.supabase.admin
      .from("policies")
      .select(
        "id,policy_number,branch,vehicle_plate,clients!policies_client_fk(id,full_name)"
      )
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (term) {
      query = query.or(await this.policySearchOrFilter(organizationId, term));
    }

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "policies.search", error, "No se pudieron buscar pólizas.");
    }

    return data ?? [];
  }

  // PostgREST no permite OR entre la tabla principal y una embebida: para que
  // la búsqueda también matchee el nombre del asegurado, primero se resuelven
  // los clientes que coinciden (acotado a 100) y se filtra por client_id.
  private async policySearchOrFilter(organizationId: string, term: string) {
    const pattern = pgrstQuote(`%${escapeLikePattern(term)}%`);
    const conditions = [`policy_number.ilike.${pattern}`, `vehicle_plate.ilike.${pattern}`];

    const { data, error } = await this.supabase.admin
      .from("clients")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .ilike("full_name", `%${escapeLikePattern(term)}%`)
      .limit(100);

    if (error) {
      // La búsqueda sigue funcionando por número/patente; se registra y continúa.
      this.logger.warn(`policies.policySearchOrFilter: ${error.message}`);
    } else if (data && data.length > 0) {
      conditions.push(`client_id.in.(${data.map((row) => row.id).join(",")})`);
    }

    return conditions.join(",");
  }

  async findNotices(organizationId: string, policyId: string): Promise<unknown[]> {
    const { data: policy, error: policyError } = await this.supabase.admin
      .from("policies")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", policyId)
      .maybeSingle();

    if (policyError) {
      throw supabaseError(this.logger, "policies.findNotices", policyError, "No se pudieron obtener los avisos.");
    }
    if (!policy) {
      throw new NotFoundException("Policy not found");
    }

    const { data, error } = await this.supabase.admin
      .from("policy_notices")
      .select(POLICY_NOTICE_SELECT)
      .eq("organization_id", organizationId)
      .eq("policy_id", policyId)
      .is("deleted_at", null)
      .order("due_date", { ascending: false })
      .order("created_at", { ascending: true, referencedTable: "notes" });

    if (error) {
      throw supabaseError(this.logger, "policies.findNotices", error, "No se pudieron obtener los avisos.");
    }

    return data ?? [];
  }

  async create(organizationId: string, userId: string, dto: CreatePolicyDto) {
    const { data, error } = await this.supabase.admin
      .from("policies")
      .insert({
        organization_id: organizationId,
        client_id: dto.clientId,
        insurance_company_id: dto.insuranceCompanyId,
        branch: dto.branch,
        policy_number: dto.policyNumber,
        vehicle_plate: dto.vehiclePlate ?? null,
        payment_interval_months: dto.paymentIntervalMonths,
        payment_method: dto.paymentMethod ?? "manual",
        first_payment_date: dto.firstPaymentDate,
        created_by_user_id: userId
      })
      .select("id,branch,policy_number,vehicle_plate,payment_interval_months,payment_method,first_payment_date,is_active,created_at")
      .single();

    if (error) {
      throw supabaseError(this.logger, "policies.create", error, "No se pudo crear la póliza.");
    }

    return data;
  }

  async update(organizationId: string, policyId: string, dto: UpdatePolicyDto) {
    // Mover el vencimiento arrastra el aviso activo que tenía la fecha vieja
    // (trigger trg_sync_policy_notice_due_date). Se valida antes el choque con
    // otro aviso de la misma póliza para explicarlo, en vez de dejar salir el
    // unique_violation genérico ("ya existe un registro con esos datos").
    if (dto.firstPaymentDate !== undefined) {
      await this.ensureNoticeDueDateIsFree(
        organizationId,
        policyId,
        dto.firstPaymentDate,
        dto.paymentMethod
      );
    }

    const updates: Record<string, unknown> = {};
    if (dto.clientId !== undefined) updates.client_id = dto.clientId;
    if (dto.insuranceCompanyId !== undefined) updates.insurance_company_id = dto.insuranceCompanyId;
    if (dto.branch !== undefined) updates.branch = dto.branch;
    if (dto.policyNumber !== undefined) updates.policy_number = dto.policyNumber;
    if (dto.vehiclePlate !== undefined) updates.vehicle_plate = dto.vehiclePlate;
    if (dto.paymentIntervalMonths !== undefined) updates.payment_interval_months = dto.paymentIntervalMonths;
    // Cambiar el tipo de pago mueve los avisos de la póliza (trigger
    // trg_policy_payment_method_notices): a débito automático archiva los
    // pendientes, y de vuelta a manual genera el aviso del vencimiento actual.
    if (dto.paymentMethod !== undefined) updates.payment_method = dto.paymentMethod;
    if (dto.firstPaymentDate !== undefined) updates.first_payment_date = dto.firstPaymentDate;

    const { data, error } = await this.supabase.admin
      .from("policies")
      .update(updates)
      .eq("id", policyId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .select(POLICY_SELECT)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new NotFoundException("Policy not found");
      }
      // El trigger que sincroniza el aviso corta con un mensaje ya redactado
      // para el usuario (raise exception → P0001); se muestra tal cual.
      if (error.code === "P0001" && error.message) {
        throw new BadRequestException(error.message);
      }
      throw supabaseError(this.logger, "policies.update", error, "No se pudo actualizar la póliza.");
    }
    if (!data) {
      throw new NotFoundException("Policy not found");
    }

    return data;
  }

  // El trigger mueve el aviso activo cuyo due_date es la fecha vieja de la
  // póliza. Si además ya existe otro aviso con la fecha nueva (uno pagado, o
  // uno soft-deleted por un revert), la unique (policy_id, due_date) aborta el
  // UPDATE entero: se detecta acá para devolver el motivo real.
  private async ensureNoticeDueDateIsFree(
    organizationId: string,
    policyId: string,
    firstPaymentDate: string,
    paymentMethod?: string
  ) {
    const { data: policy, error: policyError } = await this.supabase.admin
      .from("policies")
      .select("first_payment_date,payment_method")
      .eq("id", policyId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (policyError) {
      throw supabaseError(this.logger, "policies.update", policyError, "No se pudo actualizar la póliza.");
    }
    if (!policy) {
      throw new NotFoundException("Policy not found");
    }
    if (policy.first_payment_date === firstPaymentDate) {
      return;
    }
    // Si la póliza queda en débito automático no hay aviso que mover: el
    // trigger del tipo de pago archiva los pendientes antes de que corra el
    // sync de la fecha, así que no puede haber choque.
    if ((paymentMethod ?? policy.payment_method) !== "manual") {
      return;
    }

    const { data: notices, error: noticesError } = await this.supabase.admin
      .from("policy_notices")
      .select("id,due_date,status,deleted_at")
      .eq("policy_id", policyId)
      .eq("organization_id", organizationId)
      .in("due_date", [policy.first_payment_date, firstPaymentDate]);

    if (noticesError) {
      throw supabaseError(this.logger, "policies.update", noticesError, "No se pudo actualizar la póliza.");
    }

    const rows = (notices ?? []) as Array<{
      due_date: string;
      status: string;
      deleted_at: string | null;
    }>;
    const moves = rows.some(
      (notice) =>
        notice.due_date === policy.first_payment_date &&
        notice.deleted_at === null &&
        (notice.status === "avisar" || notice.status === "avisado")
    );
    const taken = rows.some((notice) => notice.due_date === firstPaymentDate);

    if (moves && taken) {
      throw new BadRequestException(
        "Esta póliza ya tiene un aviso con esa fecha de vencimiento. Elegí otra fecha."
      );
    }
  }

  async remove(organizationId: string, policyId: string): Promise<{ ok: true }> {
    const { data: policy, error: policyError } = await this.supabase.admin
      .from("policies")
      .select("id")
      .eq("id", policyId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (policyError) {
      throw supabaseError(this.logger, "policies.remove", policyError, "No se pudo eliminar la póliza.");
    }
    if (!policy) {
      throw new NotFoundException("Policy not found");
    }

    const { error: updateError } = await this.supabase.admin
      .from("policies")
      .update({ is_active: false })
      .eq("id", policyId)
      .eq("organization_id", organizationId);

    if (updateError) {
      throw supabaseError(this.logger, "policies.remove", updateError, "No se pudo eliminar la póliza.");
    }

    const { error: noticesError } = await this.supabase.admin
      .from("policy_notices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("policy_id", policyId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null);

    if (noticesError) {
      throw supabaseError(this.logger, "policies.remove", noticesError, "No se pudo eliminar la póliza.");
    }

    return { ok: true };
  }
}

function encodePolicyCursor(row: PolicyCursor): string {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id })).toString("base64url");
}

function decodePolicyCursor(cursor?: string | null): PolicyCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<PolicyCursor>;
    if (
      typeof parsed.created_at === "string" &&
      typeof parsed.id === "string" &&
      isIsoTimestamp(parsed.created_at) &&
      isUuid(parsed.id)
    ) {
      return { created_at: parsed.created_at, id: parsed.id };
    }
  } catch {
    // Ignore malformed cursors and fall back to the first page.
  }
  return null;
}
