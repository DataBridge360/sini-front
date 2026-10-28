import "server-only";
import { NotFoundException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import { isIsoDate, isUuid } from "@/server/core/postgrest";
import type {
  CreateNoticeNoteDto,
  ListNoticesQueryDto,
  PayNoticeDto
} from "./schemas";

type NoticeCursor = { due_date: string; id: string };

const NOTICE_SELECT =
  "id,due_date,status,paid_interval_months,notified_at,payment_processed_at,created_at,policies!policy_notices_policy_fk(id,policy_number,branch,vehicle_plate,clients!policies_client_fk(id,full_name,phone,email,notes),insurance_companies!policies_insurance_company_fk(id,name)),notified_by:user_profiles!policy_notices_notified_by_user_id_fkey(id,full_name),payment_processed_by:user_profiles!policy_notices_payment_processed_by_user_id_fkey(id,full_name),notes:notice_notes(id,note,created_at,user_id,user:user_profiles!notice_notes_user_id_fkey(id,full_name))";

export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findAll(
    organizationId: string,
    options: ListNoticesQueryDto = {}
  ): Promise<{ data: unknown[]; nextCursor: string | null }> {
    const { status, limit } = options;

    let query = this.supabase.admin
      .from("policy_notices")
      .select(NOTICE_SELECT)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .order("created_at", { ascending: true, referencedTable: "notes" });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (limit) {
      const cursor = decodeNoticeCursor(options.cursor);
      if (cursor) {
        query = query.or(
          `due_date.gt.${cursor.due_date},and(due_date.eq.${cursor.due_date},id.gt.${cursor.id})`
        );
      }
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "notices.findAll", error, "No se pudieron obtener los avisos.");
    }

    const rows = (data ?? []) as Array<{ due_date: string; id: string }>;
    const last = rows[rows.length - 1];
    const nextCursor =
      limit && last && rows.length === limit ? encodeNoticeCursor(last) : null;

    return { data: rows, nextCursor };
  }

  async markNotified(organizationId: string, noticeId: string, userId: string) {
    await this.ensureNoticeInOrganization(organizationId, noticeId);

    // p_organization_id requiere la migración 20260611090000_rpc_organization_scope:
    // desplegar este backend solo con esa migración ya aplicada.
    const { data, error } = await this.supabase.admin.rpc("mark_notice_as_notified", {
      p_notice_id: noticeId,
      p_notified_by_user_id: userId,
      p_organization_id: organizationId
    });

    if (error) {
      throw supabaseError(this.logger, "notices.markNotified", error, "No se pudo marcar el aviso como avisado.");
    }

    return data;
  }

  async pay(organizationId: string, noticeId: string, userId: string, dto: PayNoticeDto) {
    await this.ensureNoticeInOrganization(organizationId, noticeId);

    const { data, error } = await this.supabase.admin.rpc("process_policy_notice_payment", {
      p_notice_id: noticeId,
      p_interval_months: dto.paymentIntervalMonths ?? null,
      p_processed_by_user_id: userId,
      p_organization_id: organizationId
    });

    if (error) {
      throw supabaseError(this.logger, "notices.pay", error, "No se pudo registrar el pago del aviso.");
    }

    return Array.isArray(data) ? data[0] : data;
  }

  async revert(organizationId: string, noticeId: string, userId: string) {
    await this.ensureNoticeInOrganization(organizationId, noticeId);

    const { error } = await this.supabase.admin.rpc("revert_policy_notice_status", {
      p_notice_id: noticeId,
      p_actor_user_id: userId,
      p_organization_id: organizationId
    });

    if (error) {
      throw supabaseError(this.logger, "notices.revert", error, "No se pudo revertir el aviso.");
    }

    const { data, error: selectError } = await this.supabase.admin
      .from("policy_notices")
      .select(NOTICE_SELECT)
      .eq("organization_id", organizationId)
      .eq("id", noticeId)
      .is("deleted_at", null)
      .single();

    if (selectError) {
      throw supabaseError(this.logger, "notices.revert", selectError, "No se pudo revertir el aviso.");
    }

    return data;
  }

  async addNote(
    organizationId: string,
    noticeId: string,
    userId: string,
    dto: CreateNoticeNoteDto
  ) {
    await this.ensureNoticeInOrganization(organizationId, noticeId);

    const { data, error } = await this.supabase.admin
      .from("notice_notes")
      .insert({
        organization_id: organizationId,
        notice_id: noticeId,
        user_id: userId,
        note: dto.note
      })
      .select("id,note,created_at,user_id,user:user_profiles!notice_notes_user_id_fkey(id,full_name)")
      .single();

    if (error) {
      throw supabaseError(this.logger, "notices.addNote", error, "No se pudo guardar la nota.");
    }

    return data;
  }

  async deleteNote(organizationId: string, noticeId: string, noteId: string, userId: string) {
    await this.ensureNoticeInOrganization(organizationId, noticeId);

    const { data, error } = await this.supabase.admin
      .from("notice_notes")
      .delete()
      .eq("organization_id", organizationId)
      .eq("notice_id", noticeId)
      .eq("id", noteId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "notices.deleteNote", error, "No se pudo borrar la nota.");
    }
    if (!data) {
      throw new NotFoundException("Note not found");
    }

    return { ok: true };
  }

  private async ensureNoticeInOrganization(organizationId: string, noticeId: string) {
    const { data, error } = await this.supabase.admin
      .from("policy_notices")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", noticeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "notices.ensureNoticeInOrganization", error);
    }
    if (!data) {
      throw new NotFoundException("Notice not found");
    }
  }
}

function encodeNoticeCursor(row: NoticeCursor): string {
  return Buffer.from(JSON.stringify({ due_date: row.due_date, id: row.id })).toString("base64url");
}

function decodeNoticeCursor(cursor?: string | null): NoticeCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<NoticeCursor>;
    if (
      typeof parsed.due_date === "string" &&
      typeof parsed.id === "string" &&
      isIsoDate(parsed.due_date) &&
      isUuid(parsed.id)
    ) {
      return { due_date: parsed.due_date, id: parsed.id };
    }
  } catch {
    // Ignore malformed cursors and fall back to the first page.
  }
  return null;
}
