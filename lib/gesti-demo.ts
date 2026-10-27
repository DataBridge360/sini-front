import { contentTypeFor, type GestiBackend } from "@/lib/gesti-api";
import type {
  GestiChatPayload,
  GestiConversation,
  GestiConversationSummary,
  GestiStreamEvent,
  GestiUploadedFile,
  StoredGestiMessage
} from "@/lib/gesti-contract";
import { deriveChatTitle } from "@/lib/gesti-history";
import type { AppSource, GestiFileRef } from "@/lib/gesti-parts";

// Backend de la demo pública (/demo/gesti): el mismo chat del CRM, sin sesión ni
// API. Las respuestas son guiones elegidos por palabras clave y viven en
// memoria; se emiten por el mismo stream de eventos que la API real.
//
// Regla: nunca inventar datos de asegurados o pólizas; si la pregunta depende de
// la cartera, Gesti explica qué va a hacer cuando esté conectado. Lo procedimental
// (documentación de un siniestro, coberturas, borradores) sí tiene contenido
// genérico real. Cada flujo cierra con sugerencias que llevan a otro flujo.

const THINKING_MS = 900;
/** Una palabra cada tanto: se parece a lo que llega del modelo. */
const WORD_DELAY_MS = 32;

type Reply = {
  /** `[cite]` marca la cita de la primera sección de `sources`. */
  text: string;
  sources: AppSource[];
  followUps: string[];
};

const NOT_CONNECTED = "Todavía no tengo acceso a los datos de tu cartera";

const Q_EXPIRING = "¿Qué pólizas vencen esta semana?";
const Q_PAYMENTS = "¿Qué asegurados tienen cuotas pendientes?";
const Q_COVERAGE = "¿Qué diferencia hay entre terceros completo y todo riesgo?";
const Q_CLAIM_DOCS = "¿Qué documentación necesito para denunciar un siniestro de auto?";
const Q_CLAIM_STEPS = "¿Cómo le explico a un asegurado los pasos de un reclamo?";
const D_RENEWAL = "Redactá un recordatorio de vencimiento para un asegurado";
const D_WELCOME = "Escribí un mensaje de bienvenida para un cliente nuevo";
const D_DOCS = "Redactá un mensaje para pedir documentación de un siniestro";
const D_COVERAGE = "Redactá un mensaje para explicarle las coberturas a un asegurado";
const D_PAYMENT = "Redactá un mensaje para recordar una cuota de pago";

const REPLY_COVERAGE: Reply = {
  text:
    "Las coberturas de auto se arman por niveles, y los nombres cambian según la compañía:\n" +
    "• **Responsabilidad civil:** cubre los daños que causás a terceros, pero no los de tu propio vehículo.\n" +
    "• **Terceros completo:** suma robo e incendio y, según la compañía, cristales, cerraduras o granizo.\n" +
    "• **Todo riesgo:** cubre además los daños propios por choque o vuelco, normalmente con una franquicia.\n" +
    "La franquicia es el monto que paga el asegurado antes de que la compañía responda. Los alcances exactos están en las condiciones de cada póliza: confirmalos en [cite] antes de asesorar.",
  sources: ["policies", "companies"],
  followUps: [D_COVERAGE, Q_CLAIM_DOCS]
};

const REPLY_CLAIM_STEPS: Reply = {
  text:
    "Estos son los pasos habituales de un reclamo, para explicárselos a un asegurado:\n" +
    "1. Ponerse a salvo y, si hay lesionados, llamar a emergencias.\n" +
    "2. Juntar fotos de los daños y del lugar, y los datos del otro conductor si lo hubo.\n" +
    "3. Hacer la denuncia a la compañía dentro del plazo de la póliza.\n" +
    "4. Presentar la documentación que pida la compañía.\n" +
    "5. Esperar la inspección o la liquidación y consultar el estado del trámite.\n" +
    "Los tiempos y los requisitos varían según la compañía: el contacto de siniestros de cada una lo tenés en [cite].",
  sources: ["companies", "policies"],
  followUps: [Q_CLAIM_DOCS, D_DOCS]
};

const REPLY_CLAIM_DOCS: Reply = {
  text:
    "Los requisitos exactos dependen de la compañía y de la póliza, pero en un siniestro de auto casi siempre se piden:\n" +
    "• La denuncia, dentro del plazo que fija la póliza.\n" +
    "• DNI y licencia de conducir vigente del conductor.\n" +
    "• Cédula del vehículo y datos de la póliza.\n" +
    "• Fotos de los daños y del lugar, y los datos del otro conductor si lo hubo.\n" +
    "Si hay lesionados, avisá a la compañía de inmediato. Antes de presentar nada, confirmá la lista en [cite].",
  sources: ["companies", "policies", "clients"],
  followUps: [D_DOCS, Q_CLAIM_STEPS]
};

function draft(body: string, sources: AppSource[], followUps: string[]): Reply {
  return {
    text: `Te dejo un borrador para ajustar antes de enviarlo:\n\n:::borrador\n${body}\n:::\n\nCompletá los datos entre corchetes; los encontrás en [cite].`,
    sources,
    followUps
  };
}

const REPLY_DRAFT_WELCOME = draft(
  "Hola [Nombre], te damos la bienvenida. Soy [tu nombre] de [tu productora]. Ya tenés activa tu póliza [número] y, ante cualquier duda sobre la cobertura o un siniestro, me podés escribir por acá. Estoy para ayudarte.",
  ["clients", "policies"],
  [D_RENEWAL, Q_COVERAGE]
);

const REPLY_DRAFT_DOCS = draft(
  "Hola [Nombre], lamento lo sucedido. Para avanzar con la denuncia necesito que me envíes: DNI y licencia del conductor, cédula del vehículo, fotos de los daños y los datos del otro conductor, si lo hubo. En cuanto lo tenga, lo presento a la compañía.",
  ["clients", "policies", "companies"],
  [Q_CLAIM_DOCS, D_WELCOME]
);

const REPLY_DRAFT_COVERAGE = draft(
  "Hola [Nombre], te cuento cómo funcionan las coberturas: la responsabilidad civil cubre los daños a terceros, terceros completo suma robo e incendio, y todo riesgo cubre además los daños propios, con franquicia. Si querés, vemos juntos cuál te conviene.",
  ["policies", "clients"],
  [Q_COVERAGE, D_RENEWAL]
);

const REPLY_DRAFT_PAYMENT = draft(
  "Hola [Nombre], te recuerdo que la cuota de tu póliza [número] vence el [fecha]. Si ya la pagaste, ignorá este mensaje; si necesitás otra forma de pago, avisame y lo resolvemos.",
  ["policies", "notices", "clients"],
  [Q_PAYMENTS, D_WELCOME]
);

const REPLY_DRAFT_RENEWAL = draft(
  "Hola [Nombre], ¿cómo estás? Te escribo para recordarte que tu póliza [número] vence el [fecha]. Si querés renovarla o revisar la cobertura, respondeme este mensaje y lo vemos juntos. ¡Gracias!",
  ["policies", "notices", "clients"],
  [Q_EXPIRING, D_PAYMENT]
);

const REPLY_DATA_EXPIRING: Reply = {
  text:
    `${NOT_CONNECTED}, así que en esta vista previa no puedo decirte qué pólizas vencen y no quiero inventarte números. Cuando me conecten, voy a:\n` +
    "• Cruzar las vigencias de [cite] con los avisos de renovación.\n" +
    "• Ordenarlas por urgencia, con el asegurado y la compañía de cada una.\n" +
    "• Dejarte listo un recordatorio para cada asegurado.\n" +
    "Mientras tanto, los vencimientos reales los ves en Avisos.",
  sources: ["policies", "notices", "clients"],
  followUps: [D_RENEWAL, Q_PAYMENTS]
};

const REPLY_DATA_PAYMENTS: Reply = {
  text:
    `${NOT_CONNECTED}, así que en esta vista previa no puedo decirte qué cuotas están pendientes ni te voy a inventar montos. Cuando me conecten, voy a:\n` +
    "• Revisar [cite] para ver el estado de pago de cada una.\n" +
    "• Ordenar los cobros por urgencia, para que sepas a quién avisar primero.\n" +
    "• Prepararte el mensaje de recordatorio para cada asegurado.\n" +
    "Mientras tanto, los avisos de cobranza reales están en Avisos.",
  sources: ["policies", "notices", "clients"],
  followUps: [D_PAYMENT, Q_EXPIRING]
};

const REPLY_DATA_TASKS: Reply = {
  text:
    `${NOT_CONNECTED} ni al tablero del equipo, así que en esta vista previa no puedo listar pendientes. Cuando me conecten, voy a:\n` +
    "• Leer [cite] y resumirte lo que está vencido y lo que toca hoy.\n" +
    "• Indicarte la persona a cargo de cada cosa.\n" +
    "• Proponerte qué atender primero según la urgencia.",
  sources: ["tasks", "clients"],
  followUps: [Q_EXPIRING, Q_PAYMENTS]
};

const REPLY_DATA_PORTFOLIO: Reply = {
  text:
    `${NOT_CONNECTED}, así que no puedo resumirla ahora ni te voy a inventar datos de asegurados. Cuando me conecten, voy a:\n` +
    "• Cruzar la ficha del asegurado en [cite] con sus pólizas y avisos.\n" +
    "• Mostrarte en pocas líneas qué tiene contratado y qué está por vencer.\n" +
    "• Sugerirte el próximo paso, por ejemplo un mensaje de renovación.\n" +
    "Mientras tanto, podés consultar todo en las secciones de la app.",
  sources: ["clients", "policies", "notices"],
  followUps: [Q_EXPIRING, D_RENEWAL]
};

const REPLY_FALLBACK: Reply = {
  text:
    "Soy Gesti, tu asistente de seguros. Esta es una vista previa: todavía no tengo conexión con tus datos, pero ya puedo ayudarte con dudas generales como coberturas, pasos de un siniestro o borradores de mensajes para asegurados. Probá con alguna de estas preguntas.",
  sources: [],
  followUps: [Q_COVERAGE, Q_CLAIM_DOCS]
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Elige la respuesta guionada. El orden importa: primero lo que se pide
// redactar (aunque mencione pagos o siniestros), después lo procedimental, y
// recién al final lo que depende de datos reales de la cartera.
export function pickReply(text: string): Reply {
  const query = normalize(text);
  const has = (pattern: RegExp) => pattern.test(query);

  if (has(/redact|escrib|mensaje|borrador|whatsapp/)) {
    if (has(/bienvenid|nuevo/)) return REPLY_DRAFT_WELCOME;
    if (has(/document|siniestro|denuncia/)) return REPLY_DRAFT_DOCS;
    if (has(/cobertura/)) return REPLY_DRAFT_COVERAGE;
    if (has(/pago|cuota|cobr/)) return REPLY_DRAFT_PAYMENT;
    return REPLY_DRAFT_RENEWAL;
  }
  if (has(/cobertura|tercero|todo riesgo|franquicia|diferencia/)) return REPLY_COVERAGE;
  if (has(/paso|reclamo/)) return REPLY_CLAIM_STEPS;
  if (has(/document|denunci|siniestro|choque|granizo/)) return REPLY_CLAIM_DOCS;
  if (has(/vencen|vencimient|renov|vigencia/)) return REPLY_DATA_EXPIRING;
  if (has(/cobr|cuota|pago|mora|deuda|pendient/)) return REPLY_DATA_PAYMENTS;
  if (has(/tarea|equipo/)) return REPLY_DATA_TASKS;
  if (has(/resum|asegurad|cliente|cartera|poliza/)) return REPLY_DATA_PORTFOLIO;
  return REPLY_FALLBACK;
}

/** El texto tal como lo manda el server: la cita `[cite]` pasa a `[[1]]`. */
export function replyContent(reply: Reply): string {
  return reply.text.replaceAll("[cite]", "[[1]]");
}

/** Las palabras de un texto, cada una con su espacio, para emitirlas de a una. */
export function splitDeltas(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? [];
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type DemoConversation = { summary: GestiConversationSummary; messages: StoredGestiMessage[] };

export function createDemoBackend(): GestiBackend {
  const conversations = new Map<string, DemoConversation>();
  const files = new Map<string, GestiFileRef>();
  const followUps = new Map<string, string[]>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

  function requireConversation(id: string) {
    const conversation = conversations.get(id);
    if (!conversation) throw new Error("No se encontró el chat.");
    return conversation;
  }

  return {
    async listConversations() {
      return [...conversations.values()]
        .map(({ summary }) => ({ ...summary }))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    async getConversation(id): Promise<GestiConversation> {
      const { summary, messages } = requireConversation(id);
      return { ...summary, messages: [...messages] };
    },

    async updateConversation(id, payload) {
      const conversation = requireConversation(id);
      conversation.summary = {
        ...conversation.summary,
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.pinned === undefined ? {} : { pinned: payload.pinned })
      };
      return { ...conversation.summary };
    },

    async uploadFiles(selected): Promise<GestiUploadedFile[]> {
      return selected.map((file) => {
        const ref: GestiFileRef = {
          fileId: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mime: file.type || contentTypeFor(file.name)
        };
        files.set(ref.fileId, ref);
        return { ...ref, pages: null };
      });
    },

    async sendMessage(payload: GestiChatPayload, onEvent: (event: GestiStreamEvent) => void, signal: AbortSignal) {
      const now = new Date().toISOString();
      let conversation = payload.conversationId ? conversations.get(payload.conversationId) : undefined;
      if (!conversation) {
        conversation = {
          summary: {
            id: nextId("demo-chat"),
            title: deriveChatTitle(payload.message),
            pinned: false,
            createdAt: now,
            updatedAt: now
          },
          messages: []
        };
        conversations.set(conversation.summary.id, conversation);
      }
      const attachments = payload.fileIds.flatMap((fileId) => {
        const ref = files.get(fileId);
        return ref ? [ref] : [];
      });
      const userMessage: StoredGestiMessage = {
        id: nextId("demo-msg"),
        role: "user",
        content: payload.message,
        parts: attachments.length > 0 ? { attachments } : {},
        createdAt: now
      };
      conversation.messages.push(userMessage);
      onEvent({ type: "meta", conversationId: conversation.summary.id, userMessage });

      const reply = pickReply(payload.message);
      const content = replyContent(reply);
      await sleep(THINKING_MS, signal);
      if (reply.sources.length > 0) onEvent({ type: "app_sources", appSources: reply.sources });
      for (const delta of splitDeltas(content)) {
        onEvent({ type: "text", delta });
        await sleep(WORD_DELAY_MS, signal);
      }

      const sentAt = new Date().toISOString();
      const assistantMessage: StoredGestiMessage = {
        id: nextId("demo-msg"),
        role: "assistant",
        content,
        parts: reply.sources.length > 0 ? { appSources: reply.sources } : {},
        createdAt: sentAt
      };
      followUps.set(assistantMessage.id, reply.followUps);
      conversation.messages.push(assistantMessage);
      conversation.summary = { ...conversation.summary, updatedAt: sentAt };
      onEvent({ type: "done", message: assistantMessage });
    },

    followUps: (messageId) => followUps.get(messageId) ?? []
  };
}
