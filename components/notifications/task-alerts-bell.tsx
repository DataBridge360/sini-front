"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Clock,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { apiRequest, type ApiCommonOptions, type Task } from "@/lib/api";
import { readTransitionMs } from "@/lib/browser";
import {
  buildTaskAlerts,
  countUnreadAlerts,
  readTaskAlertIds,
  taskAlertLabel,
  taskAlertsStorageKey,
  writeTaskAlertIds,
  type TaskAlert,
  type TaskAlertKind
} from "@/lib/task-alerts";
import { bellAriaLabel, formatBadgeCount, taskAlertContext } from "./task-alert-helpers";

const NO_TASKS: Task[] = [];
const TICK_MS = 60_000;
// `storage` solo avisa a las otras pestañas; este evento avisa a la misma.
const READ_IDS_EVENT = "sinipro2:task-alerts-read";

const KIND_ICONS: Record<TaskAlertKind, LucideIcon> = {
  overdue: CircleAlert,
  due_today: Clock,
  due_tomorrow: CalendarClock,
  review: ClipboardCheck,
  assigned: UserRound
};

function subscribeToReadIds(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(READ_IDS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(READ_IDS_EVENT, onChange);
  };
}

function readRawIds(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

export function TaskAlertsBell({
  common,
  currentUserId,
  canModerate,
  onOpenTask,
  onOpenTasks
}: {
  common: ApiCommonOptions;
  currentUserId: string;
  canModerate: boolean;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  const tasksQuery = useQuery({
    queryKey: ["tasks", common.organizationSlug ?? ""],
    enabled: Boolean(common.token && common.organizationSlug),
    staleTime: 60_000,
    retry: 1,
    queryFn: () => apiRequest<Task[]>("/tasks", common)
  });
  const tasks = tasksQuery.data ?? NO_TASKS;

  // "Ahora" se refresca cada minuto y al volver a la ventana, para que "Vence
  // hoy" pase a "Venció ayer" sin recargar.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const alerts = useMemo(
    () => buildTaskAlerts(tasks, { currentUserId, canModerate, now }),
    [tasks, currentUserId, canModerate, now]
  );

  const storageKey = taskAlertsStorageKey(currentUserId, common.organizationSlug ?? "");
  // El snapshot es el texto crudo: es estable por valor, así React no re-renderiza
  // si no cambió, y el Set se reconstruye solo cuando cambia.
  const rawReadIds = useSyncExternalStore(
    subscribeToReadIds,
    () => readRawIds(storageKey),
    () => "[]"
  );
  // `rawReadIds` no se lee acá: solo invalida el memo cuando cambia lo guardado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const readIds = useMemo(() => readTaskAlertIds(storageKey), [storageKey, rawReadIds]);
  const unreadCount = countUnreadAlerts(alerts, readIds);

  const markRead = useCallback(
    (ids: string[]) => {
      // Se parte de lo guardado (no del render) para no pisar lo que marcó otra pestaña.
      const next = readTaskAlertIds(storageKey);
      for (const id of ids) next.add(id);
      try {
        writeTaskAlertIds(storageKey, next, alerts);
      } catch {
        // Sin storage disponible (modo privado, cuota): la campana sigue funcionando sin recordar.
      }
      window.dispatchEvent(new Event(READ_IDS_EVENT));
    },
    [storageKey, alerts]
  );

  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const close = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      if (!isVisible) return;
      const closeMs = readTransitionMs("--dropdown-close-dur", 150);
      setIsClosing(true);
      window.clearTimeout(closeTimerRef.current ?? undefined);
      closeTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
      }, closeMs);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [isVisible]
  );

  const open = useCallback(() => {
    window.clearTimeout(closeTimerRef.current ?? undefined);
    setIsVisible(true);
    setIsClosing(false);
  }, []);

  // El foco entra al panel al abrir; abrirlo no marca nada como leído.
  useEffect(() => {
    if (isVisible) panelRef.current?.focus({ preventScroll: true });
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close({ restoreFocus: false });
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isVisible, close]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current ?? undefined), []);

  function selectAlert(alert: TaskAlert) {
    markRead([alert.id]);
    close();
    onOpenTask(alert.task.id);
  }

  function openAllTasks() {
    close();
    onOpenTasks();
  }

  return (
    <div
      className="sp-bell"
      ref={wrapperRef}
      onBlur={(event) => {
        // Si el foco sale del campana+panel por teclado, se cierra sin robarlo de vuelta.
        const next = event.relatedTarget as Node | null;
        if (isVisible && next && !wrapperRef.current?.contains(next)) close({ restoreFocus: false });
      }}
    >
      <button
        ref={triggerRef}
        className="sp-bell-trigger"
        type="button"
        aria-label={bellAriaLabel(unreadCount)}
        aria-haspopup="dialog"
        aria-expanded={isVisible && !isClosing}
        onClick={() => (isVisible && !isClosing ? close() : open())}
      >
        <Bell size={19} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="sp-bell-badge" aria-hidden="true">
            {formatBadgeCount(unreadCount)}
          </span>
        ) : null}
      </button>

      {isVisible ? (
        <div
          ref={panelRef}
          className={`sp-bell-panel t-dropdown ${isClosing ? "is-closing" : "is-open"}`}
          data-origin="top-right"
          role="dialog"
          aria-label="Notificaciones"
          tabIndex={-1}
        >
          <div className="sp-bell-head">
            <h2>Notificaciones</h2>
            <button
              type="button"
              className="sp-bell-mark-all"
              disabled={unreadCount === 0}
              onClick={() => markRead(alerts.map((alert) => alert.id))}
            >
              <CheckCheck size={14} aria-hidden="true" />
              Marcar todo como leído
            </button>
          </div>

          <div className="sp-bell-body">
            {tasksQuery.isError && !tasksQuery.data ? (
              <div className="sp-bell-empty">
                <CircleAlert size={22} aria-hidden="true" />
                <strong>No pudimos cargar las tareas</strong>
                <button type="button" onClick={() => void tasksQuery.refetch()}>
                  Reintentar
                </button>
              </div>
            ) : tasksQuery.isPending && tasksQuery.fetchStatus !== "idle" ? (
              <p className="sp-bell-status" role="status">
                Cargando…
              </p>
            ) : alerts.length === 0 ? (
              <div className="sp-bell-empty">
                <CircleCheck size={22} aria-hidden="true" />
                <strong>Estás al día</strong>
                <span>No tenés tareas por vencer ni novedades.</span>
              </div>
            ) : (
              <ul className="sp-bell-list">
                {alerts.map((alert) => {
                  const Icon = KIND_ICONS[alert.kind];
                  const unread = !readIds.has(alert.id);
                  const context = taskAlertContext(alert.task);
                  return (
                    <li key={alert.id}>
                      <button
                        type="button"
                        className={`sp-bell-item${unread ? " is-unread" : ""}`}
                        onClick={() => selectAlert(alert)}
                      >
                        <span className={`sp-bell-kind is-${alert.kind}`} aria-hidden="true">
                          <Icon size={15} />
                        </span>
                        <span className="sp-bell-copy">
                          <strong>{alert.task.title}</strong>
                          <span className={`sp-bell-label is-${alert.kind}`}>{taskAlertLabel(alert)}</span>
                          {context ? <em>{context}</em> : null}
                        </span>
                        {unread ? (
                          <>
                            <span className="sp-bell-unread-dot" aria-hidden="true" />
                            <span className="sr-only">Sin leer</span>
                          </>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="sp-bell-foot">
            <button type="button" onClick={openAllTasks}>
              Ver todas las tareas
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
