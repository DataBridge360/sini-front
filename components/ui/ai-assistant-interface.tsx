"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Bell,
  BrainCircuit,
  Building2,
  FileText,
  FolderOpen,
  ListChecks,
  Paperclip,
  PenLine,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
  X,
  type LucideIcon
} from "lucide-react";
import { GestiLoader } from "@/components/ui/gesti-loader";
import { StreamingText, toTokens, type StreamToken, type StreamingSource } from "@/components/ui/streaming-text";
import type { Tab } from "@/lib/shell-types";
import { formatFileSize } from "@/lib/task-attachments";

// Interfaz de Gesti. `AIAssistantInterface` (al final) es el chat completo y se
// usa tanto en el CRM como en la demo; `AssistantStage` es su parte visual:
// estado vacío (mascota, saludo, categorías con sugerencias) y compositor.
// Cuando ya hay conversación, el hero se retira, el hilo (`children`) ocupa su
// lugar y el compositor queda fijo abajo.

const MAX_ATTACHMENTS = 6;
const MAX_TEXTAREA_PX = 200;

export type ComposerAttachment = {
  id: string;
  file: File;
  /** URL local (blob:) solo para imágenes; quien la posee debe revocarla. */
  previewUrl: string | null;
};

export type ComposerSubmission = {
  text: string;
  attachments: ComposerAttachment[];
  portfolio: boolean;
  reasoning: boolean;
};

type Category = {
  id: string;
  label: string;
  icon: LucideIcon;
  suggestions: string[];
};

const CATEGORIES: Category[] = [
  {
    id: "cartera",
    label: "Cartera",
    icon: Users,
    suggestions: [
      "¿Qué pólizas vencen esta semana?",
      "Resumime la cartera de un asegurado",
      "¿Quiénes tienen más de una póliza?"
    ]
  },
  {
    id: "siniestros",
    label: "Siniestros",
    icon: ShieldAlert,
    suggestions: [
      "¿Qué documentación necesito para denunciar un siniestro de auto?",
      "¿Cómo le explico a un asegurado los pasos de un reclamo?",
      "¿Qué diferencia hay entre terceros completo y todo riesgo?"
    ]
  },
  {
    id: "cobranzas",
    label: "Cobranzas",
    icon: Wallet,
    suggestions: [
      "¿Qué asegurados tienen cuotas pendientes?",
      "Ordename los cobros por urgencia",
      "Preparame un resumen de cobranzas del mes"
    ]
  },
  {
    id: "redactar",
    label: "Redactar",
    icon: PenLine,
    suggestions: [
      "Redactá un recordatorio de vencimiento para un asegurado",
      "Escribí un mensaje de bienvenida para un cliente nuevo",
      "Redactá un mensaje para pedir documentación de un siniestro"
    ]
  }
];

let attachmentCounter = 0;

function hasFiles(transfer: DataTransfer | null) {
  return Boolean(transfer && Array.from(transfer.types).includes("Files"));
}

export function AttachmentList({
  attachments,
  onRemove
}: {
  attachments: ComposerAttachment[];
  onRemove?: (id: string) => void;
}) {
  return (
    <ul className="gesti-attachments" aria-label="Archivos adjuntos">
      <AnimatePresence initial={false}>
        {attachments.map((attachment) => (
          <motion.li
            key={attachment.id}
            layout="position"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.16 }}
            className={attachment.previewUrl ? "gesti-attachment is-image" : "gesti-attachment is-file"}
          >
            {attachment.previewUrl ? (
              <Image
                unoptimized
                src={attachment.previewUrl}
                alt={attachment.file.name}
                width={56}
                height={56}
                className="gesti-attachment-thumb"
              />
            ) : (
              <>
                <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
                <span className="gesti-attachment-meta">
                  <span className="gesti-attachment-name">{attachment.file.name}</span>
                  <span className="gesti-attachment-size">{formatFileSize(attachment.file.size)}</span>
                </span>
              </>
            )}
            {onRemove ? (
              <button
                type="button"
                className="gesti-attachment-remove"
                aria-label={`Quitar ${attachment.file.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            ) : null}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function AssistantStage({
  firstName,
  hasConversation,
  busy,
  standalone,
  onSend,
  children
}: {
  firstName: string;
  hasConversation: boolean;
  /** Mientras Gesti responde no se puede enviar otro mensaje. */
  busy: boolean;
  /** Fuera del shell del CRM (demo): sin header ni barra inferior que compensar. */
  standalone: boolean;
  onSend: (submission: ComposerSubmission) => void;
  /** Hilo de la conversación: se muestra solo si `hasConversation`. */
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [portfolio, setPortfolio] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // URLs locales que todavía son del compositor (al enviar pasan al mensaje).
  const [pendingUrls] = useState(() => new Set<string>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();

  useEffect(() => {
    return () => {
      pendingUrls.forEach((url) => URL.revokeObjectURL(url));
      pendingUrls.clear();
    };
  }, [pendingUrls]);

  // Crece con el contenido hasta un tope; después scrollea por dentro.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !busy;
  const activeItem = CATEGORIES.find((category) => category.id === activeCategory) ?? null;

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const accepted = files.slice(0, room);
    setNotice(
      accepted.length < files.length
        ? `Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje.`
        : null
    );
    if (accepted.length === 0) return;
    const added = accepted.map<ComposerAttachment>((file) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (previewUrl) pendingUrls.add(previewUrl);
      attachmentCounter += 1;
      return { id: `att-${attachmentCounter}`, file, previewUrl };
    });
    setAttachments((current) => [...current, ...added]);
  }

  function removeAttachment(id: string) {
    const target = attachments.find((attachment) => attachment.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      pendingUrls.delete(target.previewUrl);
    }
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setNotice(null);
  }

  function submit() {
    const message = text.trim();
    if (!message || busy) return;
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) pendingUrls.delete(attachment.previewUrl);
    });
    onSend({ text: message, attachments, portfolio, reasoning });
    setText("");
    setAttachments([]);
    setNotice(null);
    setActiveCategory(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing`/229: el Enter que confirma una composición IME no envía.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    addFiles(images);
  }

  function handleDrag(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function pickSuggestion(suggestion: string) {
    setText(suggestion);
    setActiveCategory(null);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(suggestion.length, suggestion.length);
    });
  }

  return (
    <div className="gesti" data-mode={hasConversation ? "chat" : "empty"} data-standalone={standalone}>
      {hasConversation ? <div className="gesti-thread">{children}</div> : null}

      <div className="gesti-stage">
        {!hasConversation ? (
          <motion.div
            className="gesti-hero"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Image
              className="gesti-mascot"
              src="/gesti/gesti.webp"
              alt=""
              width={104}
              height={104}
              priority
            />
            <h1>{firstName ? `Hola, ${firstName}` : "Hola"}</h1>
            <p>Soy Gesti, tu asistente de seguros. ¿En qué te ayudo hoy?</p>
          </motion.div>
        ) : null}

        <div
          className="gesti-composer"
          data-dragging={dragging}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {attachments.length > 0 ? (
            <div className="gesti-composer-attachments">
              <AttachmentList attachments={attachments} onRemove={removeAttachment} />
            </div>
          ) : null}
          {notice ? (
            <p className="gesti-composer-notice" role="status">
              {notice}
            </p>
          ) : null}

          <textarea
            ref={textareaRef}
            className="gesti-composer-input"
            rows={1}
            value={text}
            placeholder={hasConversation ? "Escribile a Gesti…" : "Preguntale a Gesti sobre tu cartera, siniestros o cobranzas…"}
            aria-label="Mensaje para Gesti"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />

          <div className="gesti-composer-bar">
            <div className="gesti-composer-tools">
              <button
                type="button"
                className="gesti-tool-btn"
                aria-label="Adjuntar archivos o imágenes"
                title="Adjuntar archivos o imágenes"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={16} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                className="gesti-chip"
                aria-pressed={portfolio}
                onClick={() => setPortfolio((value) => !value)}
              >
                <FolderOpen size={14} strokeWidth={1.9} aria-hidden="true" />
                Cartera
              </button>
              <button
                type="button"
                className="gesti-chip"
                aria-pressed={reasoning}
                onClick={() => setReasoning((value) => !value)}
              >
                <BrainCircuit size={14} strokeWidth={1.9} aria-hidden="true" />
                Razonar
              </button>
            </div>
            <button
              type="button"
              className="gesti-send"
              aria-label="Enviar mensaje"
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>

        <p className="gesti-disclaimer">
          <span className="gesti-preview-badge">Vista previa</span>
          Gesti puede equivocarse. Verificá los datos importantes.
        </p>

        {!hasConversation ? (
          <div className="gesti-categories">
            <div className="gesti-category-grid">
              {CATEGORIES.map((category) => {
                const Icon = category.icon;
                const active = category.id === activeCategory;
                return (
                  <button
                    key={category.id}
                    type="button"
                    className="gesti-category"
                    aria-expanded={active}
                    aria-controls={suggestionsId}
                    onClick={() => setActiveCategory(active ? null : category.id)}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    {category.label}
                  </button>
                );
              })}
            </div>

            <AnimatePresence initial={false}>
              {activeItem ? (
                <motion.div
                  key="suggestions"
                  id={suggestionsId}
                  className="gesti-suggestions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="gesti-suggestions-card">
                    <p>Sugerencias de {activeItem.label.toLowerCase()}</p>
                    <ul key={activeItem.id}>
                      {activeItem.suggestions.map((suggestion, index) => {
                        const Icon = activeItem.icon;
                        return (
                          <motion.li
                            key={suggestion}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.03 }}
                          >
                            <button type="button" onClick={() => pickSuggestion(suggestion)}>
                              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                              {suggestion}
                            </button>
                          </motion.li>
                        );
                      })}
                    </ul>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat completo: hilo de mensajes + respuestas guionadas.
//
// Es solo frontend: las respuestas se eligen por palabras clave. Regla: nunca
// inventar datos de asegurados o pólizas; si la pregunta depende de la cartera,
// Gesti explica qué va a hacer cuando esté conectado. Lo procedimental
// (documentación de un siniestro, coberturas, borradores) sí tiene contenido
// genérico real. Cada flujo cierra con sugerencias que llevan a otro flujo.
// ---------------------------------------------------------------------------

const THINKING_MS = 900;
const REASONING_MS = 1600;
// Distancia al fondo (px) hasta la que se considera que el usuario "sigue" el hilo.
const FOLLOW_THRESHOLD_PX = 160;
// Fracción de la distancia restante que recorre el scroll en cada cuadro.
const SCROLL_EASE = 0.2;

type SourceKey = "notices" | "policies" | "clients" | "tasks" | "companies";

const SOURCE_META: Record<SourceKey, { name: string; hint: string; tab: Tab; icon: LucideIcon }> = {
  notices: { name: "Avisos", hint: "Vencimientos y renovaciones", tab: "notices", icon: Bell },
  policies: { name: "Pólizas", hint: "Vigencias y coberturas", tab: "policies", icon: ShieldCheck },
  clients: { name: "Asegurados", hint: "Fichas y contactos", tab: "clients", icon: Users },
  tasks: { name: "Tareas", hint: "Pendientes del equipo", tab: "tasks", icon: ListChecks },
  companies: { name: "Compañías", hint: "Contactos y requisitos", tab: "companies", icon: Building2 }
};

// `[cite]` en el texto se dibuja como chip de la primera fuente.
type Reply = { text: string; sources: SourceKey[]; followUps: string[] };

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
    "• Responsabilidad civil: cubre los daños que causás a terceros, pero no los de tu propio vehículo.\n" +
    "• Terceros completo: suma robo e incendio y, según la compañía, cristales, cerraduras o granizo.\n" +
    "• Todo riesgo: cubre además los daños propios por choque o vuelco, normalmente con una franquicia.\n" +
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

function draft(body: string, sources: SourceKey[], followUps: string[]): Reply {
  return {
    text: `Te dejo un borrador para ajustar antes de enviarlo:\n\n${body}\n\nCompletá los datos entre corchetes; los encontrás en [cite].`,
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
function pickReply(text: string, portfolio: boolean): Reply {
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
  if (has(/resum|asegurad|cliente|cartera|poliza/) || portfolio) return REPLY_DATA_PORTFOLIO;
  return REPLY_FALLBACK;
}

type UserMessage = {
  id: string;
  role: "user";
  text: string;
  attachments: ComposerAttachment[];
};

type AssistantMessage = {
  id: string;
  role: "assistant";
  /** Falso mientras se muestra "Gesti está pensando". */
  ready: boolean;
  reasoning: boolean;
  tokens: StreamToken[];
  sources: SourceKey[];
  followUps: string[];
};

type ChatMessage = UserMessage | AssistantMessage;

let messageCounter = 0;
function nextMessageId() {
  messageCounter += 1;
  return `gesti-msg-${messageCounter}`;
}

function scrollingElement() {
  return document.scrollingElement ?? document.documentElement;
}

export function AIAssistantInterface({
  userName,
  onNavigate
}: {
  userName: string;
  /** Sin esto (demo) las fuentes se muestran pero no navegan. */
  onNavigate?: (tab: Tab) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Mensaje de Gesti que está pensando o escribiendo; null cuando está libre.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [timers] = useState(() => new Set<number>());
  // URLs locales de las imágenes enviadas: pasan a ser del hilo y se revocan al salir.
  const [ownedUrls] = useState(() => new Set<string>());
  // Si el usuario está leyendo el final del hilo, el scroll acompaña lo nuevo.
  const followRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);

  const firstName = userName.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedUrls.clear();
    };
  }, [timers, ownedUrls]);

  const cancelScrollFrame = useCallback(() => {
    if (scrollFrameRef.current === null) return;
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  }, []);

  useEffect(() => {
    function updateFollow() {
      // Mientras el scroll se desliza solo, la distancia es transitoria: no cuenta.
      if (scrollFrameRef.current !== null) return;
      const element = scrollingElement();
      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
    }
    // Si el usuario toma el control, se corta el deslizamiento automático.
    function userTookOver() {
      cancelScrollFrame();
      followRef.current = false;
      updateFollow();
    }
    window.addEventListener("scroll", updateFollow, { passive: true });
    window.addEventListener("wheel", userTookOver, { passive: true });
    window.addEventListener("touchmove", userTookOver, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateFollow);
      window.removeEventListener("wheel", userTookOver);
      window.removeEventListener("touchmove", userTookOver);
      cancelScrollFrame();
    };
  }, [cancelScrollFrame]);

  // Desliza hacia el final con un cuadro por vez (no un salto por palabra) y
  // solo si el usuario está siguiendo el hilo.
  const scrollToEnd = useCallback(() => {
    if (!followRef.current || scrollFrameRef.current !== null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function step() {
      scrollFrameRef.current = null;
      if (!followRef.current) return;
      const element = scrollingElement();
      const distance = element.scrollHeight - element.clientHeight - element.scrollTop;
      if (distance < 1) return;
      element.scrollTop += reduceMotion ? distance : Math.max(1, distance * SCROLL_EASE);
      scrollFrameRef.current = window.requestAnimationFrame(step);
    }
    scrollFrameRef.current = window.requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  const busy = activeId !== null;

  function send({ text, attachments, portfolio, reasoning }: ComposerSubmission) {
    const reply = pickReply(text, portfolio);
    const userMessage: UserMessage = { id: nextMessageId(), role: "user", text, attachments };
    const assistantMessage: AssistantMessage = {
      id: nextMessageId(),
      role: "assistant",
      ready: false,
      reasoning,
      tokens: toTokens(reply.text),
      sources: reply.sources,
      followUps: reply.followUps
    };

    attachments.forEach((attachment) => {
      if (attachment.previewUrl) ownedUrls.add(attachment.previewUrl);
    });
    followRef.current = true;
    setActiveId(assistantMessage.id);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const timer = window.setTimeout(() => {
      timers.delete(timer);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id && message.role === "assistant" ? { ...message, ready: true } : message
        )
      );
    }, reasoning ? REASONING_MS : THINKING_MS);
    timers.add(timer);
  }

  function sendFollowUp(text: string) {
    if (busy) return;
    send({ text, attachments: [], portfolio: false, reasoning: false });
  }

  function sourcesFor(keys: SourceKey[]): StreamingSource[] {
    return keys.map((key) => {
      const meta = SOURCE_META[key];
      return {
        id: key,
        name: meta.name,
        hint: meta.hint,
        icon: meta.icon,
        onSelect: onNavigate ? () => onNavigate(meta.tab) : undefined
      };
    });
  }

  const lastMessage = messages[messages.length - 1];

  return (
    <AssistantStage
      firstName={firstName}
      hasConversation={messages.length > 0}
      busy={busy}
      standalone={!onNavigate}
      onSend={send}
    >
      <ol className="gesti-messages" aria-label="Conversación con Gesti">
        {messages.map((message) =>
          message.role === "user" ? (
            <motion.li
              key={message.id}
              className="gesti-msg is-user"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="gesti-bubble">
                {message.attachments.length > 0 ? <AttachmentList attachments={message.attachments} /> : null}
                <p>{message.text}</p>
              </div>
            </motion.li>
          ) : (
            <motion.li
              key={message.id}
              className="gesti-msg is-assistant"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              <span className="gesti-msg-avatar">
                {message.ready ? (
                  <Image src="/gesti/gesti-avatar.webp" alt="Gesti" width={28} height={28} />
                ) : (
                  <GestiLoader
                    size={28}
                    label={message.reasoning ? "Gesti está razonando" : "Gesti está pensando"}
                  />
                )}
              </span>
              <div className="gesti-msg-body">
                {message.ready ? (
                  <StreamingText
                    tokens={message.tokens}
                    sources={sourcesFor(message.sources)}
                    followUps={message === lastMessage ? message.followUps : []}
                    onFollowUp={sendFollowUp}
                    onProgress={scrollToEnd}
                    onStreamingChange={(streaming) =>
                      setActiveId((current) => (streaming ? message.id : current === message.id ? null : current))
                    }
                  />
                ) : (
                  <p className="gesti-thinking" aria-hidden="true">
                    {message.reasoning ? "Gesti está razonando…" : "Gesti está pensando…"}
                  </p>
                )}
              </div>
            </motion.li>
          )
        )}
      </ol>
    </AssistantStage>
  );
}
