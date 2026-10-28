"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Bell,
  Building2,
  FileText,
  ListChecks,
  Mic,
  PenLine,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
  X,
  type LucideIcon
} from "lucide-react";
import { GestiChatHeader, GestiHistoryPanel, type ChatHeaderProps, type HistoryActions } from "@/components/ui/gesti-history-panel";
import { GestiLoader } from "@/components/ui/gesti-loader";
import { GestiChart } from "@/components/ui/gesti-chart";
import {
  GestiDocumentCards,
  GestiQuestionCard,
  useFileDownload
} from "@/components/ui/gesti-message-parts";
import { GestiUsagePanel } from "@/components/ui/gesti-usage-panel";
import { StreamingText, type StreamingSource } from "@/components/ui/streaming-text";
import { useIsWideScreen } from "@/lib/browser";
import { validateGestiFile, type GestiBackend } from "@/lib/gesti-api";
import {
  GESTI_CACHE_GC_MS,
  GESTI_CHAT_STALE_MS,
  GESTI_LIST_STALE_MS,
  gestiQueryKeys,
  isCacheFresh,
  recallOpenChat,
  rememberOpenChat
} from "@/lib/gesti-cache";
import {
  GESTI_UPLOAD_ACCEPT,
  MAX_GESTI_FILES_PER_MESSAGE,
  type GestiStreamEvent,
  type GestiUploadedFile,
  type StoredGestiMessage
} from "@/lib/gesti-contract";
import {
  deriveChatTitle,
  formatMessageTime,
  toHistoryChat,
  type HistoryChat
} from "@/lib/gesti-history";
import type { AppSource, ChartLink, MessageParts } from "@/lib/gesti-parts";
import type { Tab } from "@/lib/shell-types";
import { formatFileSize } from "@/lib/task-attachments";
import { dictationErrorMessage, dictationPhaseLabel, mergeDictation, useDictation } from "@/lib/use-dictation";

// Interfaz de Gesti. `AIAssistantInterface` (al final) es el chat completo y se
// usa tanto en el CRM (conectado a la API) como en la demo (respuestas
// guionadas en memoria): los dos le pasan un `GestiBackend`. `AssistantStage`
// es su parte visual: estado vacío (mascota, saludo, categorías con
// sugerencias) y compositor. Cuando ya hay conversación, el hero se retira, el
// hilo (`children`) ocupa su lugar y el compositor queda fijo abajo. El
// historial de chats (columna en escritorio, panel deslizable en pantallas
// angostas) y la barra con el título del chat están en gesti-history-panel.tsx.

const MAX_TEXTAREA_PX = 200;
// Más que esto (en líneas) y el compositor deja de ser una sola fila.
const SINGLE_LINE_RATIO = 1.5;
// Alto relativo de cada barra de la onda del dictado (la animación las mueve entre 35% y 100% de esto).
const WAVE_BARS = [0.5, 0.85, 0.65, 1, 0.75, 0.9, 0.55];
// Desde este ancho el historial es una columna fija al lado del chat.
const HISTORY_DOCK_MIN_PX = 1180;
const FLASH_MS = 4000;
const CHAT_ERROR = "No pude responder ahora. Probá de nuevo en un momento.";

/** Lo que se muestra de un adjunto; los del historial ya no tienen el archivo local. */
export type AttachmentView = {
  id: string;
  name: string;
  size: number;
  /** URL local (blob:) solo para imágenes; quien la posee debe revocarla. */
  previewUrl: string | null;
  /** Archivo guardado en el server: se puede volver a abrir. */
  fileId?: string | null;
};

export type ComposerAttachment = AttachmentView & { file: File };

export type ComposerSubmission = {
  text: string;
  attachments: ComposerAttachment[];
};

export type SendResult = { ok: true } | { ok: false; message: string };

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

let idCounter = 0;
function uniqueId(prefix: string, counter = ++idCounter) {
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function hasFiles(transfer: DataTransfer | null) {
  return Boolean(transfer && Array.from(transfer.types).includes("Files"));
}

export function AttachmentList({
  attachments,
  onRemove,
  onOpen
}: {
  attachments: AttachmentView[];
  onRemove?: (id: string) => void;
  /** Para los adjuntos ya guardados: abre el archivo. */
  onOpen?: ((fileId: string) => void) | undefined;
}) {
  return (
    <ul className="gesti-attachments" aria-label="Archivos adjuntos">
      <AnimatePresence initial={false}>
        {attachments.map((attachment) => {
          const fileId = attachment.fileId;
          const content = attachment.previewUrl ? (
            <Image
              unoptimized
              src={attachment.previewUrl}
              alt={attachment.name}
              width={56}
              height={56}
              className="gesti-attachment-thumb"
            />
          ) : (
            <>
              <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
              <span className="gesti-attachment-meta">
                <span className="gesti-attachment-name">{attachment.name}</span>
                <span className="gesti-attachment-size">{formatFileSize(attachment.size)}</span>
              </span>
            </>
          );
          return (
            <motion.li
              key={attachment.id}
              layout="position"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.16 }}
              className={attachment.previewUrl ? "gesti-attachment is-image" : "gesti-attachment is-file"}
            >
              {onOpen && fileId ? (
                <button
                  type="button"
                  className="gesti-attachment-open"
                  title={`Abrir ${attachment.name}`}
                  onClick={() => onOpen(fileId)}
                >
                  {content}
                </button>
              ) : (
                content
              )}
              {onRemove ? (
                <button
                  type="button"
                  className="gesti-attachment-remove"
                  aria-label={`Quitar ${attachment.name}`}
                  onClick={() => onRemove(attachment.id)}
                >
                  <X size={11} strokeWidth={2.4} />
                </button>
              ) : null}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function AssistantStage({
  firstName,
  hasConversation,
  busy,
  standalone,
  focusOnMount,
  onSend,
  children
}: {
  firstName: string;
  hasConversation: boolean;
  /** Mientras Gesti responde no se puede enviar otro mensaje. */
  busy: boolean;
  /** Fuera del shell del CRM (demo): sin header ni barra inferior que compensar. */
  standalone: boolean;
  /** Al abrir un chat nuevo desde el historial, el cursor queda listo para escribir. */
  focusOnMount: boolean;
  /** Los adjuntos se suben antes de enviar: `onProgress` va de 0 a 1 y, si falla, el compositor conserva todo. */
  onSend: (submission: ComposerSubmission, onProgress: (fraction: number) => void) => Promise<SendResult>;
  /** Hilo de la conversación: se muestra solo si `hasConversation`. */
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Subiendo los adjuntos del mensaje que se está enviando.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const sending = uploadProgress !== null;
  // El texto no entra en una línea: el compositor pasa a caja y se queda así
  // hasta vaciarlo (si no, al ensancharse volvería a entrar y parpadearía).
  const [wrapped, setWrapped] = useState(false);
  // Lo que ya estaba escrito cuando se empezó a dictar; el dictado se suma a eso.
  const dictationBaseRef = useRef("");
  const dictation = useDictation({
    lang: "es-AR",
    onText: (finalText, interimText) => setText(mergeDictation(dictationBaseRef.current, finalText, interimText))
  });
  // Mientras hay dictado en curso (preparando, escuchando o cerrando) no se escribe a mano.
  const dictating = dictation.active;
  const wasDictatingRef = useRef(false);
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

  useEffect(() => {
    if (focusOnMount) textareaRef.current?.focus();
  }, [focusOnMount]);

  // Al terminar el dictado el campo vuelve a ser editable, con el cursor al final.
  useEffect(() => {
    if (wasDictatingRef.current && !dictating) {
      const element = textareaRef.current;
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    }
    wasDictatingRef.current = dictating;
  }, [dictating]);

  // El foco queda en el botón del micrófono: Escape tiene que valer desde ahí también.
  const cancelDictation = dictation.cancel;
  useEffect(() => {
    if (!dictating) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelDictation();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dictating, cancelDictation]);

  // Crece con el contenido hasta un tope; después scrollea por dentro. De paso
  // detecta si el texto ya no entra en una línea, que lo mide en la fila única.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const height = element.scrollHeight;
    element.style.height = `${Math.min(height, MAX_TEXTAREA_PX)}px`;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
    setWrapped((current) => (text.length === 0 ? false : current || height > lineHeight * SINGLE_LINE_RATIO));
    // Al terminar el dictado se vuelve a medir, ya con el campo en su forma normal.
  }, [text, attachments.length, dictating]);

  const expanded = dictating || attachments.length > 0 || wrapped || text.includes("\n");
  const locked = dictating || sending;
  const canSend = text.trim().length > 0 && !busy && !locked;
  const hint = notice ?? dictationErrorMessage(dictation.error);
  const activeItem = CATEGORIES.find((category) => category.id === activeCategory) ?? null;

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const problems: string[] = [];
    const valid: File[] = [];
    for (const file of files) {
      const problem = validateGestiFile(file);
      if (problem) problems.push(problem);
      else valid.push(file);
    }
    const room = Math.max(0, MAX_GESTI_FILES_PER_MESSAGE - attachments.length);
    const accepted = valid.slice(0, room);
    if (accepted.length < valid.length) {
      problems.push(`Podés adjuntar hasta ${MAX_GESTI_FILES_PER_MESSAGE} archivos por mensaje.`);
    }
    setNotice(problems[0] ?? null);
    if (accepted.length === 0) return;
    const added = accepted.map<ComposerAttachment>((file) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (previewUrl) pendingUrls.add(previewUrl);
      attachmentCounter += 1;
      return { id: uniqueId("att", attachmentCounter), file, name: file.name, size: file.size, previewUrl };
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

  function clearComposer() {
    setText("");
    setAttachments([]);
    setNotice(null);
    setActiveCategory(null);
    textareaRef.current?.focus();
  }

  async function submit() {
    const message = text.trim();
    if (!message || busy || sending) return;
    // Cortar en seco: lo que llegue tarde no puede reescribir el campo ya vacío.
    dictation.cancel();
    const submission: ComposerSubmission = { text: message, attachments };
    if (attachments.length === 0) {
      // Sin archivos no hay nada que subir: se envía y el campo queda vacío de una.
      void onSend(submission, () => {});
      clearComposer();
      return;
    }
    setNotice(null);
    setUploadProgress(0);
    const result = await onSend(submission, setUploadProgress);
    setUploadProgress(null);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    // Las imágenes pasan a ser del mensaje enviado: ya no las revoca el compositor.
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) pendingUrls.delete(attachment.previewUrl);
    });
    clearComposer();
  }

  function toggleDictation() {
    if (dictating) {
      dictation.stop();
      return;
    }
    dictationBaseRef.current = text;
    dictation.start();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Dictando, ni siquiera Enter envía: el campo todavía no es del usuario.
    if (dictating) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    // `isComposing`/229: el Enter que confirma una composición IME no envía.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (locked) {
      event.preventDefault();
      return;
    }
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    addFiles(images);
  }

  function handleDrag(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    // Se frena igual (si no, el navegador abre el archivo) pero no se adjunta.
    if (!locked) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(false);
    if (!locked) addFiles(Array.from(event.dataTransfer.files));
  }

  function pickSuggestion(suggestion: string) {
    dictation.cancel();
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

        <div className="gesti-composer-hints">
          {hint ? (
            <p className="gesti-composer-notice" role="status">
              {hint}
            </p>
          ) : null}
          {/* Lo visible es el indicador del compositor; esto es para lectores de pantalla. */}
          <p className="gesti-sr-only" role="status">
            {dictationPhaseLabel(dictation.phase)}
          </p>
        </div>

        <div
          className="gesti-composer"
          data-expanded={expanded}
          data-dictating={dictating}
          data-sending={sending}
          data-empty={text.length === 0}
          data-dragging={dragging}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {attachments.length > 0 ? (
            <div className="gesti-composer-attachments">
              <AttachmentList attachments={attachments} {...(sending ? {} : { onRemove: removeAttachment })} />
              {sending ? (
                <div
                  className="gesti-upload"
                  role="progressbar"
                  aria-label="Subiendo archivos"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((uploadProgress ?? 0) * 100)}
                >
                  <span className="gesti-upload-bar">
                    <span style={{ width: `${Math.round((uploadProgress ?? 0) * 100)}%` }} />
                  </span>
                  <span className="gesti-upload-label">Subiendo archivos…</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="gesti-composer-row">
            <button
              type="button"
              className="gesti-tool-btn"
              aria-label="Adjuntar archivos o imágenes"
              title="Adjuntar archivos o imágenes"
              disabled={locked}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={20} strokeWidth={1.8} />
            </button>

            <textarea
              ref={textareaRef}
              className="gesti-composer-input"
              rows={1}
              value={text}
              placeholder={
                dictating
                  ? ""
                  : hasConversation
                    ? "Escribile a Gesti…"
                    : "Preguntale a Gesti sobre tu cartera, siniestros o cobranzas…"
              }
              aria-label="Mensaje para Gesti"
              readOnly={locked}
              aria-readonly={locked || undefined}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />

            {dictating ? (
              <div className="gesti-dictation" data-phase={dictation.phase} aria-hidden="true">
                <span className="gesti-wave">
                  {WAVE_BARS.map((height, index) => (
                    <span key={index} style={{ "--h": height, "--i": index } as CSSProperties} />
                  ))}
                </span>
                <span className="gesti-dictation-label">{dictationPhaseLabel(dictation.phase)}</span>
              </div>
            ) : null}

            <div className="gesti-composer-actions">
              {dictation.supported ? (
                <button
                  type="button"
                  className="gesti-mic-btn"
                  data-phase={dictation.phase}
                  aria-label={dictating ? "Detener dictado" : "Dictar"}
                  title={dictating ? "Detener dictado" : "Dictar"}
                  aria-pressed={dictating}
                  disabled={dictation.phase === "finishing" || sending}
                  onClick={toggleDictation}
                >
                  <Mic size={19} strokeWidth={1.8} />
                </button>
              ) : null}
              <button
                type="button"
                className="gesti-send"
                aria-label="Enviar mensaje"
                disabled={!canSend}
                onClick={() => void submit()}
              >
                <ArrowUp size={18} strokeWidth={2.4} />
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            accept={GESTI_UPLOAD_ACCEPT}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>

        <p className="gesti-disclaimer">Gesti puede equivocarse. Verificá los datos importantes.</p>

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
// Chat completo: hilo de mensajes + conexión con el backend.
//
// Los chats, los mensajes y los archivos viven en el server (o en memoria, en
// la demo): acá solo está lo que se ve. Un mensaje de Gesti pasa por tres fases:
// `pending` (pensando, todavía sin texto), `streaming` (llega el texto) y
// `done` (el server mandó la respuesta tal como la guardó).
// ---------------------------------------------------------------------------

// Distancia al fondo (px) hasta la que se considera que el usuario "sigue" el hilo.
const FOLLOW_THRESHOLD_PX = 160;
// Fracción de la distancia restante que recorre el scroll en cada cuadro.
const SCROLL_EASE = 0.2;

const SOURCE_META: Record<AppSource, { name: string; hint: string; tab: Tab; icon: LucideIcon }> = {
  notices: { name: "Avisos", hint: "Vencimientos y renovaciones", tab: "notices", icon: Bell },
  policies: { name: "Pólizas", hint: "Vigencias y coberturas", tab: "policies", icon: ShieldCheck },
  clients: { name: "Asegurados", hint: "Fichas y contactos", tab: "clients", icon: Users },
  tasks: { name: "Tareas", hint: "Pendientes del equipo", tab: "tasks", icon: ListChecks },
  companies: { name: "Compañías", hint: "Contactos y requisitos", tab: "companies", icon: Building2 }
};

type UserMessage = {
  key: string;
  role: "user";
  text: string;
  attachments: AttachmentView[];
  /** Archivos ya subidos: para volver a intentar un envío que falló. */
  fileIds: string[];
};

type AssistantMessage = {
  key: string;
  role: "assistant";
  phase: "pending" | "streaming" | "done";
  /** Lo recibido hasta ahora; al terminar, el texto que guardó el server. */
  text: string;
  parts: MessageParts;
  /** Qué está haciendo ("Buscando en internet…"); null si está escribiendo. */
  status: string | null;
  /** Hora de la respuesta. */
  sentAt: number;
  /** Se escribió en esta vista: entra animada. Las del historial aparecen quietas. */
  fresh: boolean;
  /** Id guardado en el server, cuando ya terminó. */
  id: string | null;
};

type ChatMessage = UserMessage | AssistantMessage;

function toAttachmentViews(parts: MessageParts): AttachmentView[] {
  return (parts.attachments ?? []).map((file) => ({
    id: file.fileId,
    name: file.name,
    size: file.size,
    previewUrl: null,
    fileId: file.fileId
  }));
}

function fromStored(message: StoredGestiMessage): ChatMessage {
  const sentAt = Date.parse(message.createdAt);
  if (message.role === "user") {
    return {
      key: message.id,
      role: "user",
      text: message.content,
      attachments: toAttachmentViews(message.parts),
      fileIds: (message.parts.attachments ?? []).map((file) => file.fileId)
    };
  }
  return {
    key: message.id,
    role: "assistant",
    phase: "done",
    text: message.content,
    parts: message.parts,
    status: null,
    sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(),
    fresh: false,
    id: message.id
  };
}

// Lo que se guarda en el caché: sin la animación de entrada ni las URLs locales
// de las imágenes (se revocan al salir de la vista). Devuelve el mismo arreglo
// si no hay nada que limpiar, para no reescribir el caché sin cambios.
function toCachedMessages(messages: ChatMessage[]): ChatMessage[] {
  let changed = false;
  const cached = messages.map((message): ChatMessage => {
    if (message.role === "assistant") {
      if (!message.fresh) return message;
      changed = true;
      return { ...message, fresh: false };
    }
    if (message.attachments.every((attachment) => attachment.previewUrl === null)) return message;
    changed = true;
    return { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, previewUrl: null })) };
  });
  return changed ? cached : messages;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function scrollingElement() {
  return document.scrollingElement ?? document.documentElement;
}

function UserBubble({
  message,
  resolveUrl
}: {
  message: UserMessage;
  resolveUrl: ((fileId: string) => Promise<string>) | undefined;
}) {
  const { download, failedId } = useFileDownload(resolveUrl);
  return (
    <div className="gesti-bubble">
      {message.attachments.length > 0 ? (
        <AttachmentList attachments={message.attachments} onOpen={download} />
      ) : null}
      {failedId ? (
        <p className="gesti-bubble-error" role="alert">
          No se pudo abrir el archivo.
        </p>
      ) : null}
      <p>{message.text}</p>
    </div>
  );
}

export function AIAssistantInterface({
  userName,
  backend,
  onNavigate,
  onOpenRecord,
  usageScope = "default",
  cacheScope
}: {
  userName: string;
  /** De dónde salen los chats y las respuestas: la API en el CRM, guiones en la demo. */
  backend: GestiBackend;
  /** Sin esto (demo) las fuentes se muestran pero no navegan. */
  onNavigate?: (tab: Tab) => void;
  /** Abre el registro de una fila de tabla (tarea, póliza, cliente…). Sin esto (demo) las filas no son clickeables. */
  onOpenRecord?: (link: ChartLink) => void;
  /** Separa el caché del consumo por organización. */
  usageScope?: string;
  /**
   * Separa el caché de chats (usuario + organización) y hace que sobreviva a
   * salir de la vista. Sin esto (demo) el caché es solo de esta vista.
   */
  cacheScope?: string;
}) {
  const queryClient = useQueryClient();
  const [viewScope] = useState(() => uniqueId("gesti-view"));
  const scope = cacheScope ?? viewScope;
  // Al volver a la pestaña se reabre el último chat, con sus mensajes del caché.
  const [restored] = useState(() => {
    const chatId = cacheScope ? recallOpenChat(cacheScope) : null;
    const cached = chatId ? queryClient.getQueryData<ChatMessage[]>(gestiQueryKeys.chat(scope, chatId)) : undefined;
    return { chatId, messages: cached ?? [] };
  });

  const listQuery = useQuery({
    queryKey: gestiQueryKeys.list(scope),
    queryFn: async () => (await backend.listConversations()).map(toHistoryChat),
    staleTime: GESTI_LIST_STALE_MS,
    gcTime: GESTI_CACHE_GC_MS
  });
  const chats = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const listState = {
    loading: listQuery.isPending,
    error: listQuery.isError && !listQuery.data ? "No se pudieron cargar tus chats." : null
  };
  // Los cambios locales (chat nuevo, título, fijado) van directo al caché.
  const setChats = useCallback(
    (update: (current: HistoryChat[]) => HistoryChat[]) => {
      queryClient.setQueryData<HistoryChat[]>(gestiQueryKeys.list(scope), (current) => update(current ?? []));
    },
    [queryClient, scope]
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(restored.chatId);
  const [messages, setMessages] = useState<ChatMessage[]>(restored.messages);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // Hay una respuesta en camino: no se puede enviar otro mensaje.
  const [busy, setBusy] = useState(false);
  // Cambia al abrir otro chat o uno nuevo: remonta la vista (compositor limpio).
  const [viewKey, setViewKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Columna del historial visible en escritorio (en memoria, no se guarda).
  const [dockOpen, setDockOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const docked = useIsWideScreen(HISTORY_DOCK_MIN_PX);
  // Lo que cambia entre un render y un gesto del usuario va en refs, para que
  // los callbacks asíncronos vean siempre el chat y la vista de ahora.
  const chatIdRef = useRef<string | null>(restored.chatId);
  const messagesRef = useRef<ChatMessage[]>(restored.messages);
  const viewRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadTokenRef = useRef(0);
  const jumpToEndRef = useRef(restored.messages.length > 0);
  const flashTimerRef = useRef<number | undefined>(undefined);
  // URLs locales de las imágenes enviadas: pasan a ser del hilo y se revocan al salir.
  const [ownedUrls] = useState(() => new Set<string>());
  // Si el usuario está leyendo el final del hilo, el scroll acompaña lo nuevo.
  const followRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Mensajes enviados en esta vista: solo ellos entran animados (los del
  // historial aparecen quietos al abrir el chat).
  const [freshKeys] = useState(() => new Set<string>());

  const firstName = userName.trim().split(/\s+/)[0] ?? "";
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const hasConversation = messages.length > 0 || activeChatId !== null;

  // La búsqueda por contenido llega hasta los chats cuyos mensajes están cargados.
  const searchableChats = useMemo(
    () =>
      chats.map((chat) =>
        chat.id === activeChatId && messages.length > 0
          ? { ...chat, messages: messages.map((message) => ({ text: message.text })) }
          : chat
      ),
    [chats, activeChatId, messages]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (cacheScope) rememberOpenChat(cacheScope, activeChatId);
  }, [cacheScope, activeChatId]);

  // El chat que se reabre al volver: sale del caché y se revalida si está viejo.
  useEffect(() => {
    if (restored.chatId) loadChat(restored.chatId, { fallbackToNew: true });
    // Solo al montar: después, abrir chats es cosa de `openChat`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con el chat quieto (sin respuesta en camino), sus mensajes pasan al caché.
  useEffect(() => {
    if (!activeChatId || busy || loadingChat || messages.length === 0) return;
    if (messages.some((message) => message.role === "assistant" && message.phase !== "done")) return;
    const key = gestiQueryKeys.chat(scope, activeChatId);
    const cached = toCachedMessages(messages);
    if (queryClient.getQueryData(key) === cached) return;
    queryClient.setQueryData(key, cached);
  }, [activeChatId, busy, loadingChat, messages, queryClient, scope]);

  useEffect(() => {
    return () => {
      // Salir con una respuesta en camino: el server guarda lo que alcanzó a
      // escribir, así que el caché de ese chat ya no está al día.
      if (inFlightRef.current && chatIdRef.current) {
        void queryClient.invalidateQueries({
          queryKey: gestiQueryKeys.chat(scope, chatIdRef.current),
          refetchType: "none"
        });
      }
      abortRef.current?.abort();
      window.clearTimeout(flashTimerRef.current);
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedUrls.clear();
    };
  }, [ownedUrls, queryClient, scope]);

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

  // Un chat nuevo arranca arriba; uno del historial muestra su final de una,
  // apenas llegan los mensajes (`jumpToEndRef`).
  const scrolledViewRef = useRef(0);
  useLayoutEffect(() => {
    if (viewKey === scrolledViewRef.current) return;
    scrolledViewRef.current = viewKey;
    cancelScrollFrame();
    followRef.current = true;
    scrollingElement().scrollTop = 0;
  }, [viewKey, cancelScrollFrame]);

  useLayoutEffect(() => {
    if (!jumpToEndRef.current || messages.length === 0) return;
    jumpToEndRef.current = false;
    cancelScrollFrame();
    followRef.current = true;
    const element = scrollingElement();
    element.scrollTop = element.scrollHeight;
  }, [messages, cancelScrollFrame]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  // El panel deslizable no tiene sentido con la columna fija.
  const drawerOpen = historyOpen && !docked;
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [drawerOpen]);

  function showFlash(message: string) {
    window.clearTimeout(flashTimerRef.current);
    setFlash(message);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }

  // Si falla, el caché se queda con la lista que ya tiene.
  function refreshList() {
    void queryClient.invalidateQueries({ queryKey: gestiQueryKeys.list(scope) });
  }

  function patchAssistant(key: string, update: (message: AssistantMessage) => AssistantMessage) {
    setMessages((current) =>
      current.map((message) => (message.key === key && message.role === "assistant" ? update(message) : message))
    );
  }

  // Un evento del stream sobre la respuesta `key`.
  function applyEvent(event: GestiStreamEvent, key: string, isNewChat: boolean, firstText: string) {
    switch (event.type) {
      case "meta": {
        chatIdRef.current = event.conversationId;
        setActiveChatId(event.conversationId);
        if (isNewChat) {
          const now = Date.now();
          setChats((current) =>
            current.some((chat) => chat.id === event.conversationId)
              ? current
              : [
                  {
                    id: event.conversationId,
                    title: deriveChatTitle(firstText),
                    pinned: false,
                    createdAt: now,
                    updatedAt: now
                  },
                  ...current
                ]
          );
        }
        return;
      }
      case "title":
        if (chatIdRef.current) {
          const id = chatIdRef.current;
          setChats((current) => current.map((chat) => (chat.id === id ? { ...chat, title: event.title } : chat)));
        }
        return;
      case "status":
        patchAssistant(key, (message) => ({ ...message, status: event.label }));
        return;
      case "text":
        patchAssistant(key, (message) => ({
          ...message,
          phase: "streaming",
          status: null,
          text: message.text + event.delta
        }));
        return;
      case "sources":
        patchAssistant(key, (message) => ({ ...message, parts: { ...message.parts, sources: event.sources } }));
        return;
      case "app_sources":
        patchAssistant(key, (message) => ({ ...message, parts: { ...message.parts, appSources: event.appSources } }));
        return;
      case "chart":
        patchAssistant(key, (message) => ({
          ...message,
          parts: { ...message.parts, charts: [...(message.parts.charts ?? []), event.chart] }
        }));
        return;
      case "question":
        patchAssistant(key, (message) => ({ ...message, status: null, parts: { ...message.parts, question: event.question } }));
        return;
      case "document":
        patchAssistant(key, (message) => ({
          ...message,
          parts: { ...message.parts, documents: [...(message.parts.documents ?? []), event.file] }
        }));
        return;
      case "done": {
        const stored = fromStored(event.message);
        if (stored.role !== "assistant") return;
        patchAssistant(key, (message) => ({ ...stored, key: message.key, fresh: message.fresh }));
        const id = chatIdRef.current;
        if (id) {
          setChats((current) => current.map((chat) => (chat.id === id ? { ...chat, updatedAt: Date.now() } : chat)));
        }
        return;
      }
      case "error":
        patchAssistant(key, (message) => ({
          ...message,
          phase: "done",
          status: null,
          text: message.text || event.message,
          parts: { ...message.parts, notice: "error" }
        }));
        return;
    }
  }

  // Manda el mensaje y deja que la respuesta se vaya armando. No espera a que termine.
  function dispatch(text: string, attachments: AttachmentView[], fileIds: string[]) {
    const userMessage: UserMessage = { key: uniqueId("gesti-msg"), role: "user", text, attachments, fileIds };
    const assistantKey = uniqueId("gesti-msg");
    const assistantMessage: AssistantMessage = {
      key: assistantKey,
      role: "assistant",
      phase: "pending",
      text: "",
      parts: {},
      status: null,
      sentAt: Date.now(),
      fresh: true,
      id: null
    };
    const isNewChat = chatIdRef.current === null;
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    freshKeys.add(userMessage.key);
    freshKeys.add(assistantKey);
    followRef.current = true;
    setBusy(true);
    setChatError(null);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    backend
      .sendMessage(
        { conversationId: chatIdRef.current, message: text, fileIds },
        (event) => {
          if (!controller.signal.aborted) applyEvent(event, assistantKey, isNewChat, text);
        },
        controller.signal
      )
      .catch((error: unknown) => {
        // Cortar a propósito (cambiar de chat, salir) no es un error.
        if (controller.signal.aborted || isAbortError(error)) return;
        patchAssistant(assistantKey, (message) => ({
          ...message,
          phase: "done",
          status: null,
          text: message.text || CHAT_ERROR,
          parts: { ...message.parts, notice: "error" }
        }));
      })
      .finally(() => {
        if (abortRef.current !== controller) return;
        abortRef.current = null;
        inFlightRef.current = false;
        setBusy(false);
        // Si el stream se cortó sin `done`, la respuesta queda como llegó.
        patchAssistant(assistantKey, (message) => (message.phase === "done" ? message : { ...message, phase: "done", status: null }));
        if (isNewChat) refreshList();
      });
  }

  async function send(
    { text, attachments }: ComposerSubmission,
    onProgress: (fraction: number) => void
  ): Promise<SendResult> {
    if (inFlightRef.current) return { ok: false, message: "Gesti todavía está respondiendo." };
    const startedView = viewRef.current;
    let uploaded: GestiUploadedFile[] = [];
    if (attachments.length > 0) {
      inFlightRef.current = true;
      try {
        uploaded = await backend.uploadFiles(
          attachments.map((attachment) => attachment.file),
          onProgress
        );
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error && error.message ? error.message : "No se pudieron subir los archivos."
        };
      } finally {
        inFlightRef.current = false;
      }
      // Cambió de chat mientras subía: ese mensaje ya no es de esta conversación.
      if (viewRef.current !== startedView) return { ok: false, message: "Se canceló el envío." };
    }
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) ownedUrls.add(attachment.previewUrl);
    });
    dispatch(
      text,
      attachments.map(({ id, name, size, previewUrl }, index) => ({
        id,
        name,
        size,
        previewUrl,
        fileId: uploaded[index]?.fileId ?? null
      })),
      uploaded.map((file) => file.fileId)
    );
    return { ok: true };
  }

  function sendQuickReply(text: string) {
    if (inFlightRef.current) return;
    dispatch(text, [], []);
  }

  function retryLast() {
    if (inFlightRef.current) return;
    const lastUser = [...messages].reverse().find((message): message is UserMessage => message.role === "user");
    if (lastUser) dispatch(lastUser.text, lastUser.attachments, lastUser.fileIds);
  }

  // Con el chat en el caché se muestra al instante y, si está viejo, se
  // revalida en segundo plano; si no, se pide al server.
  function loadChat(chatId: string, { fallbackToNew = false } = {}) {
    const token = ++loadTokenRef.current;
    const key = gestiQueryKeys.chat(scope, chatId);
    const cached = queryClient.getQueryData<ChatMessage[]>(key);
    setChatError(null);
    if (cached) {
      jumpToEndRef.current = true;
      setMessages(cached);
      setLoadingChat(false);
      const state = queryClient.getQueryState(key);
      if (!state?.isInvalidated && isCacheFresh(state?.dataUpdatedAt ?? 0, Date.now(), GESTI_CHAT_STALE_MS)) return;
    } else {
      setLoadingChat(true);
    }
    queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: async () => (await backend.getConversation(chatId)).messages.map(fromStored),
        staleTime: 0,
        gcTime: GESTI_CACHE_GC_MS
      })
      .then((loaded) => {
        if (token !== loadTokenRef.current) return;
        // Mientras se revalidaba, el usuario siguió escribiendo: no se pisa.
        if (cached && messagesRef.current !== cached) return;
        if (!cached) jumpToEndRef.current = true;
        setMessages(loaded);
        setLoadingChat(false);
      })
      .catch(() => {
        if (token !== loadTokenRef.current || cached) return;
        // El chat que se recordaba ya no está (otro dispositivo, otra sesión): chat nuevo.
        if (fallbackToNew) {
          openChat(null);
          return;
        }
        setLoadingChat(false);
        setChatError("No se pudo abrir esta conversación.");
      });
  }

  function openChat(chatId: string | null) {
    setHistoryOpen(false);
    if (chatId === chatIdRef.current) return;
    // Una respuesta en curso se corta: el server guarda lo que alcanzó a
    // escribir, así que ese chat se vuelve a pedir la próxima vez.
    if (abortRef.current && chatIdRef.current) {
      void queryClient.invalidateQueries({
        queryKey: gestiQueryKeys.chat(scope, chatIdRef.current),
        refetchType: "none"
      });
    }
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setBusy(false);
    loadTokenRef.current += 1;
    chatIdRef.current = chatId;
    viewRef.current += 1;
    setActiveChatId(chatId);
    setMessages([]);
    setLoadingChat(false);
    setChatError(null);
    setViewKey((current) => current + 1);
    if (chatId) loadChat(chatId);
  }

  function closeDrawer() {
    setHistoryOpen(false);
    historyToggleRef.current?.focus();
  }

  const historyActions: HistoryActions = {
    onNewChat: () => openChat(null),
    onSelect: openChat
  };

  // Renombrar y fijar se ven al instante; si el server no lo acepta, vuelve atrás.
  function updateChat(chatId: string, change: { title?: string; pinned?: boolean }, failure: string) {
    const previous = chats.find((chat) => chat.id === chatId);
    if (!previous) return;
    const revert = { title: previous.title, pinned: previous.pinned };
    setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, ...change } : chat)));
    backend.updateConversation(chatId, change).catch(() => {
      setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, ...revert } : chat)));
      showFlash(failure);
    });
  }

  // Acciones del chat abierto, desde la barra de arriba.
  const headerActions: Pick<ChatHeaderProps, "onRename" | "onTogglePin"> = {
    onRename: (chatId, title) => updateChat(chatId, { title }, "No se pudo renombrar el chat."),
    onTogglePin: (chatId) => {
      const target = chats.find((chat) => chat.id === chatId);
      if (target) updateChat(chatId, { pinned: !target.pinned }, "No se pudo cambiar el chat fijado.");
    }
  };

  function sourcesFor(keys: AppSource[] | undefined): StreamingSource[] {
    return (keys ?? []).map((key) => {
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

  function toggleSidebar() {
    if (docked) setDockOpen((open) => !open);
    else setHistoryOpen(true);
  }

  const usage = backend.usage;

  return (
    <div
      className="gesti-layout"
      data-docked={docked}
      data-sidebar={docked && dockOpen ? "open" : "closed"}
      data-standalone={!onNavigate}
    >
      {docked && dockOpen ? (
        <aside className="gesti-history-dock">
          <GestiHistoryPanel
            chats={searchableChats}
            activeChatId={activeChatId}
            loading={listState.loading}
            error={listState.error}
            onRetry={() => void listQuery.refetch()}
            {...historyActions}
          />
        </aside>
      ) : null}

      <div className="gesti-main">
        <GestiChatHeader
          chat={activeChat}
          docked={docked}
          sidebarOpen={docked ? dockOpen : drawerOpen}
          toggleRef={historyToggleRef}
          onToggleSidebar={toggleSidebar}
          onNewChat={historyActions.onNewChat}
          onRename={headerActions.onRename}
          onTogglePin={headerActions.onTogglePin}
          onOpenUsage={usage ? () => setUsageOpen(true) : undefined}
        />

        {flash ? (
          <p className="gesti-flash" role="status">
            {flash}
          </p>
        ) : null}

        <AssistantStage
          key={viewKey}
          firstName={firstName}
          hasConversation={hasConversation}
          busy={busy}
          standalone={!onNavigate}
          focusOnMount={viewKey > 0 && activeChatId === null}
          onSend={send}
        >
          {loadingChat ? (
            <p className="gesti-thread-state" role="status">
              Cargando conversación…
            </p>
          ) : null}
          {chatError ? (
            <div className="gesti-thread-state" role="alert">
              <p>{chatError}</p>
              {activeChatId ? (
                <button type="button" onClick={() => loadChat(activeChatId)}>
                  Reintentar
                </button>
              ) : null}
            </div>
          ) : null}
          <ol className="gesti-messages" aria-label="Conversación con Gesti">
            {messages.map((message) => {
              const entering = freshKeys.has(message.key);
              if (message.role === "user") {
                return (
                  <motion.li
                    key={message.key}
                    className="gesti-msg is-user"
                    initial={entering ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <UserBubble message={message} resolveUrl={backend.fileUrl} />
                  </motion.li>
                );
              }
              const working = message.phase !== "done";
              const isLast = message === lastMessage;
              const hasText = message.text.length > 0;
              const parts = message.parts;
              const followUps = isLast && !working && message.id ? (backend.followUps?.(message.id) ?? []) : [];
              const failed = parts.notice === "error";
              return (
                <motion.li
                  key={message.key}
                  className="gesti-msg is-assistant"
                  data-notice={parts.notice}
                  initial={entering ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                >
                  <span className="gesti-msg-avatar">
                    {working ? (
                      <GestiLoader size={28} label={message.status ?? "Gesti está pensando"} />
                    ) : (
                      <Image src="/gesti/gesti-avatar.webp" alt="Gesti" width={28} height={28} />
                    )}
                  </span>
                  <div className="gesti-msg-body">
                    <p className="gesti-msg-meta">
                      <span>Gesti</span>
                      <time dateTime={new Date(message.sentAt).toISOString()}>{formatMessageTime(message.sentAt)}</time>
                    </p>
                    {hasText ? (
                      <StreamingText
                        text={message.text}
                        final={!working}
                        instant={!message.fresh}
                        webSources={parts.sources ?? []}
                        appSources={sourcesFor(parts.appSources)}
                        followUps={followUps}
                        onFollowUp={sendQuickReply}
                        {...(failed && isLast && !busy ? { onRetry: retryLast } : {})}
                        onProgress={scrollToEnd}
                        embeds={(parts.charts ?? []).map((chart, index) => ({
                          key: `${index}-${chart.title}`,
                          position: chart.position,
                          node: <GestiChart chart={chart} onOpenRecord={onOpenRecord} />
                        }))}
                      />
                    ) : null}
                    {working && (!hasText || message.status) ? (
                      <p className="gesti-thinking" aria-live="polite">
                        {message.status ?? "Gesti está pensando…"}
                      </p>
                    ) : null}
                    {hasText || !parts.charts?.length ? null : (
                      <div className="gesti-parts">
                        {parts.charts.map((chart, index) => (
                          <GestiChart key={`${index}-${chart.title}`} chart={chart} onOpenRecord={onOpenRecord} />
                        ))}
                      </div>
                    )}
                    <GestiDocumentCards documents={parts.documents ?? []} resolveUrl={backend.fileUrl} />
                    {parts.question ? (
                      <GestiQuestionCard
                        question={parts.question}
                        interactive={isLast && !working && !busy}
                        onAnswer={sendQuickReply}
                      />
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </AssistantStage>
      </div>

      {usage ? (
        <GestiUsagePanel isOpen={usageOpen} onClose={() => setUsageOpen(false)} load={usage} scope={usageScope} />
      ) : null}

      <AnimatePresence>
        {drawerOpen ? (
          <motion.div
            key="backdrop"
            className="gesti-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeDrawer}
          />
        ) : null}
        {drawerOpen ? (
          <motion.div
            key="drawer"
            ref={drawerRef}
            tabIndex={-1}
            className="gesti-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Historial de chats"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDrawer();
            }}
          >
            <GestiHistoryPanel
              chats={searchableChats}
              activeChatId={activeChatId}
              loading={listState.loading}
              error={listState.error}
              onRetry={() => void listQuery.refetch()}
              onClose={closeDrawer}
              {...historyActions}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
