import "server-only";
import type { GestiConversation, GestiConversationSummary, StoredGestiMessage } from "@/lib/gesti-contract";
import { messagePartsSchema, type MessageParts } from "@/lib/gesti-parts";
import { BadRequestException, NotFoundException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import type { UpdateConversationDto } from "./schemas";

// Conversaciones y mensajes. Los chats son PRIVADOS de quien los creó: toda
// consulta filtra por organización Y usuario, y uno ajeno responde 404 (no
// 403) para no confirmar que existe. Este servicio no borra nada: los chats
// no se borran (no hay DELETE en la API ni en la UI).

const LIST_LIMIT = 200;
const MESSAGES_LIMIT = 1000;

const CONVERSATION_COLUMNS = "id,title,pinned,created_at,updated_at";
const MESSAGE_COLUMNS = "id,role,content,parts,created_at";

type ConversationRow = {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: unknown;
  created_at: string;
};

export function toConversationSummary(row: ConversationRow): GestiConversationSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toStoredMessage(row: MessageRow): StoredGestiMessage {
  const parts = messagePartsSchema.safeParse(row.parts);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    parts: parts.success ? parts.data : {},
    createdAt: row.created_at
  };
}

export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(organizationId: string, userId: string): Promise<GestiConversationSummary[]> {
    const { data, error } = await this.supabase.admin
      .from("gesti_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT);

    if (error) {
      throw supabaseError(this.logger, "gesti.list", error, "No se pudieron obtener las conversaciones.");
    }
    return ((data ?? []) as unknown as ConversationRow[]).map(toConversationSummary);
  }

  async findOne(organizationId: string, userId: string, conversationId: string): Promise<GestiConversation> {
    const conversation = await this.requireOwned(organizationId, userId, conversationId);

    const { data, error } = await this.supabase.admin
      .from("gesti_messages")
      .select(MESSAGE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(MESSAGES_LIMIT);

    if (error) {
      throw supabaseError(this.logger, "gesti.findOne", error, "No se pudo obtener la conversación.");
    }
    return {
      ...toConversationSummary(conversation),
      messages: ((data ?? []) as unknown as MessageRow[]).map(toStoredMessage)
    };
  }

  async update(
    organizationId: string,
    userId: string,
    conversationId: string,
    dto: UpdateConversationDto
  ): Promise<GestiConversationSummary> {
    await this.requireOwned(organizationId, userId, conversationId);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.pinned !== undefined) patch.pinned = dto.pinned;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("No hay cambios para guardar.");
    }

    const { data, error } = await this.supabase.admin
      .from("gesti_conversations")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("id", conversationId)
      .select(CONVERSATION_COLUMNS)
      .single();

    if (error) {
      throw supabaseError(this.logger, "gesti.update", error, "No se pudo actualizar la conversación.");
    }
    return toConversationSummary(data as unknown as ConversationRow);
  }

  /** La conversación si es de este usuario en esta organización; si no, 404. */
  async requireOwned(organizationId: string, userId: string, conversationId: string): Promise<ConversationRow> {
    const { data, error } = await this.supabase.admin
      .from("gesti_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("id", conversationId)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "gesti.requireOwned", error, "No se pudo obtener la conversación.");
    }
    if (!data) {
      throw new NotFoundException("Conversation not found");
    }
    return data as unknown as ConversationRow;
  }

  async create(organizationId: string, userId: string, title: string): Promise<GestiConversationSummary> {
    const { data, error } = await this.supabase.admin
      .from("gesti_conversations")
      .insert({ organization_id: organizationId, user_id: userId, title })
      .select(CONVERSATION_COLUMNS)
      .single();

    if (error) {
      throw supabaseError(this.logger, "gesti.create", error, "No se pudo crear la conversación.");
    }
    return toConversationSummary(data as unknown as ConversationRow);
  }

  async setTitle(organizationId: string, userId: string, conversationId: string, title: string) {
    const { error } = await this.supabase.admin
      .from("gesti_conversations")
      .update({ title })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("id", conversationId);

    if (error) {
      this.logger.warn(`gesti.setTitle: ${error.message}`);
    }
  }

  async addMessage(
    organizationId: string,
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    parts: MessageParts
  ): Promise<StoredGestiMessage> {
    const { data, error } = await this.supabase.admin
      .from("gesti_messages")
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        role,
        content,
        parts
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) {
      throw supabaseError(this.logger, "gesti.addMessage", error, "No se pudo guardar el mensaje.");
    }

    // Sube el chat en la lista de recientes.
    const touched = await this.supabase.admin
      .from("gesti_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", conversationId);
    if (touched.error) {
      this.logger.warn(`gesti.addMessage.touch: ${touched.error.message}`);
    }

    return toStoredMessage(data as unknown as MessageRow);
  }

  /** Los últimos `limit` mensajes en orden cronológico. */
  async recentMessages(organizationId: string, conversationId: string, limit: number): Promise<StoredGestiMessage[]> {
    const { data, error } = await this.supabase.admin
      .from("gesti_messages")
      .select(MESSAGE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw supabaseError(this.logger, "gesti.recentMessages", error, "No se pudo obtener la conversación.");
    }
    return ((data ?? []) as unknown as MessageRow[]).map(toStoredMessage).reverse();
  }
}
