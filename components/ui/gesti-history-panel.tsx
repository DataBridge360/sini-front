"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { ConfirmDialog } from "@/components/ui/modal";
import Image from "next/image";
import { MessageSquare, Pencil, PanelLeft, Pin, Plus, Search, SquarePen, Trash2, X } from "lucide-react";
import { findMatch, groupChats, searchChats, type StoredChat } from "@/lib/gesti-history";

// Historial de chats de Gesti. `GestiHistoryPanel` es la barra lateral: marca,
// búsqueda (título y contenido), "Nuevo chat" y la lista agrupada por fecha.
// `GestiChatHeader` es la barra de arriba del chat, con el título y las
// acciones del chat abierto (fijar, renombrar, eliminar). El panel se usa como
// columna en escritorio y dentro de un panel deslizable en pantallas angostas.

const TICK_MS = 60_000;
const MAX_TITLE_INPUT = 80;

export type HistoryActions = {
  onNewChat: () => void;
  onSelect: (id: string) => void;
};

function Highlight({ text, query }: { text: string; query: string }) {
  const match = findMatch(text, query);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="gesti-history-mark">{text.slice(match.start, match.end)}</mark>
      {text.slice(match.end)}
    </>
  );
}

export function GestiHistoryPanel({
  chats,
  activeChatId,
  onClose,
  ...actions
}: HistoryActions & {
  chats: StoredChat[];
  activeChatId: string | null;
  /** Solo en el panel deslizable: muestra el botón para cerrarlo. */
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // "Hoy" y "Ayer" se recalculan cada minuto, por si el día cambia con la app abierta.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const searching = query.trim().length > 0;
  const results = searching ? searchChats(chats, query) : [];
  const groups = searching ? [] : groupChats(chats, now);

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  }

  return (
    <nav className="gesti-history" aria-label="Historial de chats">
      <div className="gesti-history-brand">
        <span className="gesti-history-logo">
          <Image src="/gesti/gesti-avatar.webp" alt="" width={40} height={40} />
        </span>
        <div className="gesti-history-brand-text">
          <p className="gesti-history-name">Gesti</p>
          <p className="gesti-history-tagline">Tu asistente de seguros</p>
        </div>
        {onClose ? (
          <button type="button" className="gesti-icon-btn" aria-label="Cerrar historial" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className="gesti-history-search">
        <Search size={16} strokeWidth={1.9} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Buscar chats"
          aria-label="Buscar chats"
          aria-controls={listId}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKey}
        />
        {query ? (
          <button
            type="button"
            className="gesti-history-clear"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      <button type="button" className="gesti-history-new" onClick={actions.onNewChat}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        Nuevo chat
      </button>

      <div className="gesti-history-list" id={listId}>
        {chats.length === 0 ? (
          <div className="gesti-history-empty">
            <MessageSquare size={18} strokeWidth={1.8} aria-hidden="true" />
            <p>Tus conversaciones con Gesti van a aparecer acá.</p>
          </div>
        ) : searching ? (
          results.length === 0 ? (
            <div className="gesti-history-empty" role="status">
              <Search size={18} strokeWidth={1.8} aria-hidden="true" />
              <p>Sin resultados para “{query.trim()}”.</p>
            </div>
          ) : (
            <section aria-label="Resultados de la búsqueda">
              <p className="gesti-history-group-label" role="status">
                {results.length === 1 ? "1 resultado" : `${results.length} resultados`}
              </p>
              <ul>
                {results.map(({ chat, snippet }) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    query={query}
                    snippet={snippet}
                    onSelect={actions.onSelect}
                  />
                ))}
              </ul>
            </section>
          )
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <p className="gesti-history-group-label">{group.label}</p>
              <ul>
                {group.chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    onSelect={actions.onSelect}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}

function ChatItem({
  chat,
  active,
  query = "",
  snippet = null,
  onSelect
}: Pick<HistoryActions, "onSelect"> & {
  chat: StoredChat;
  active: boolean;
  query?: string;
  snippet?: string | null;
}) {
  const Icon = chat.pinned ? Pin : MessageSquare;
  return (
    <li className="gesti-history-item" data-active={active}>
      <button
        type="button"
        className="gesti-history-link"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(chat.id)}
      >
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span className="gesti-history-link-body">
          <span className="gesti-history-link-title">
            <Highlight text={chat.title} query={query} />
          </span>
          {snippet ? (
            <span className="gesti-history-snippet">
              <Highlight text={snippet} query={query} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

// ---------- Barra del chat ----------

export type ChatHeaderProps = {
  /** Chat abierto; null en un chat nuevo (sin acciones propias todavía). */
  chat: Pick<StoredChat, "id" | "title" | "pinned"> | null;
  /** Escritorio ancho: el botón muestra u oculta la columna; si no, abre el panel. */
  docked: boolean;
  /** Columna visible (escritorio) o panel abierto (pantallas angostas). */
  sidebarOpen: boolean;
  toggleRef?: Ref<HTMLButtonElement>;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
};

export function GestiChatHeader({
  chat,
  docked,
  sidebarOpen,
  toggleRef,
  onToggleSidebar,
  onNewChat,
  onRename,
  onTogglePin,
  onDelete
}: ChatHeaderProps) {
  // Se guarda el chat que se está renombrando o eliminando: al cambiar de chat
  // el estado deja de aplicar solo, sin efectos para limpiarlo.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const renameRef = useRef<HTMLButtonElement>(null);
  // El Escape que cancela desmonta el campo: su blur no debe guardar.
  const renameDoneRef = useRef(false);

  const renaming = chat !== null && renamingId === chat.id;
  const confirming = chat !== null && confirmId === chat.id;

  function startRename() {
    if (!chat) return;
    renameDoneRef.current = false;
    setConfirmId(null);
    setDraft(chat.title);
    setRenamingId(chat.id);
  }

  function finishRename(save: boolean, restoreFocus: boolean) {
    if (!chat || renameDoneRef.current) return;
    renameDoneRef.current = true;
    const title = draft.replace(/\s+/g, " ").trim();
    if (save && title && title !== chat.title) onRename(chat.id, title);
    setRenamingId(null);
    if (restoreFocus) requestAnimationFrame(() => renameRef.current?.focus());
  }

  const toggleLabel = docked ? (sidebarOpen ? "Ocultar chats" : "Mostrar chats") : "Ver chats";

  return (
    <header className="gesti-bar">
      <button
        ref={toggleRef}
        type="button"
        className="gesti-bar-btn"
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={sidebarOpen}
        aria-haspopup={docked ? undefined : "dialog"}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={20} strokeWidth={1.8} />
      </button>
      <span className="gesti-bar-divider" aria-hidden="true" />

      {renaming ? (
        <input
          className="gesti-bar-rename"
          value={draft}
          maxLength={MAX_TITLE_INPUT}
          aria-label="Nuevo nombre del chat"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finishRename(true, false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishRename(true, true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finishRename(false, true);
            }
          }}
        />
      ) : (
        <h2 className="gesti-bar-title" title={chat?.title}>
          {chat?.title ?? "Nuevo chat"}
        </h2>
      )}

      <div className="gesti-bar-actions">
        {chat ? (
          <>
            <button
              type="button"
              className="gesti-bar-btn"
              aria-label={chat.pinned ? "Desfijar" : "Fijar"}
              title={chat.pinned ? "Desfijar" : "Fijar"}
              aria-pressed={chat.pinned}
              onClick={() => onTogglePin(chat.id)}
            >
              <Pin size={20} strokeWidth={1.8} />
            </button>
            <button
              ref={renameRef}
              type="button"
              className="gesti-bar-btn"
              aria-label="Renombrar"
              title="Renombrar"
              onClick={startRename}
            >
              <Pencil size={20} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="gesti-bar-btn"
              aria-label="Eliminar"
              title="Eliminar"
              aria-haspopup="dialog"
              onClick={() => setConfirmId(chat.id)}
            >
              <Trash2 size={20} strokeWidth={1.8} />
            </button>
          </>
        ) : null}
        {docked ? null : (
          <button type="button" className="gesti-bar-btn" aria-label="Nuevo chat" title="Nuevo chat" onClick={onNewChat}>
            <SquarePen size={20} strokeWidth={1.8} />
          </button>
        )}

      </div>

      <ConfirmDialog
        isOpen={confirming}
        title="Eliminar chat"
        message={`¿Eliminar “${chat?.title ?? ""}”? Se borra la conversación completa y no se puede deshacer.`}
        confirmLabel="Eliminar chat"
        isBusy={false}
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (!chat) return;
          setConfirmId(null);
          onDelete(chat.id);
        }}
      />
    </header>
  );
}
