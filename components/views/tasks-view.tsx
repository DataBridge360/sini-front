"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  apiRequest,
  apiUploadForm,
  type ApiCommonOptions,
  type Client,
  type OrganizationMember,
  type Policy,
  type TaskDetail,
  type TaskFormPayload,
  type TaskListItem,
  type TaskStats,
  type TaskStatus
} from "@/lib/api";
import { useIsWideScreen } from "@/lib/browser";
import {
  EMPTY_TASK_FILTERS,
  hasActiveTaskFilters,
  matchesTaskFilters,
  sortTasksByDueDate,
  TASK_BOARD_STATUSES,
  TASK_STATUS_META,
  type TaskFilters
} from "@/lib/tasks";
import { ArchivedTasksPanel } from "@/components/tasks/archived-tasks-panel";
import type { TaskApi } from "@/components/tasks/shared";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { TaskList } from "@/components/tasks/task-list";
import { TaskStatusTabs } from "@/components/tasks/task-status-tabs";
import { ErrorState, LoadingState } from "@/components/ui/states";

const NO_TASKS: TaskListItem[] = [];
const NO_MEMBERS: OrganizationMember[] = [];

// Ancho a partir del cual el kanban con arrastre es cómodo. Por debajo, las tres
// columnas no entran y se navega por pestañas.
const BOARD_MIN_WIDTH = 900;

export function TasksView({
  common,
  currentUserId,
  canModerate,
  initialArchived = false,
  clients,
  policies,
  notify
}: {
  common: ApiCommonOptions;
  currentUserId: string;
  canModerate: boolean;
  // Se entra derecho a Archivadas (por ejemplo desde el recuento de
  // finalizadas del dashboard). La vista se remonta al cambiar de pestaña, así
  // que alcanza con sembrar el estado inicial.
  initialArchived?: boolean;
  clients: Client[];
  policies: Policy[];
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const queryClient = useQueryClient();
  const slug = common.organizationSlug ?? "";
  const tasksKey = ["tasks", slug];
  // Prefijo: invalidar acá alcanza todos los alcances (equipo y por persona).
  const statsKey = ["task-stats", slug];

  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<TaskStatus>("pendiente");
  const [isArchivedOpen, setIsArchivedOpen] = useState(initialArchived);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const isWide = useIsWideScreen(BOARD_MIN_WIDTH);

  // Solo tareas activas: las archivadas se piden aparte y paginadas.
  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: () => apiRequest<TaskListItem[]>("/tasks", common)
  });

  // Cuántas finalizadas hay en total. Es un COUNT en el servidor, no el largo de
  // una lista: el tablero nunca trae las archivadas y son las que crecen sin
  // techo. Misma clave que usa el dashboard, así se comparte la caché.
  const statsQuery = useQuery({
    queryKey: [...statsKey, "all"],
    staleTime: 60_000,
    queryFn: () => apiRequest<TaskStats>("/tasks/stats", common)
  });
  const archivedCount = statsQuery.data?.finalizado ?? null;

  const members = useQuery({
    queryKey: ["organization-members", slug],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<OrganizationMember[]>("/organizations/current/members", common)
  });

  const onError = (error: Error) => notify(error.message, "error");

  // El detalle vive en su propia query; el listado solo trae contadores. Tras
  // cualquier escritura hay que refrescar ambos.
  const invalidateTask = (taskId: string) => {
    void queryClient.invalidateQueries({ queryKey: tasksKey });
    void queryClient.invalidateQueries({ queryKey: ["task", slug, taskId] });
  };

  const setDetailCache = (task: TaskDetail) => {
    queryClient.setQueryData(["task", slug, task.id], task);
  };

  const createTask = useMutation({
    mutationFn: (payload: TaskFormPayload) =>
      apiRequest<TaskDetail>("/tasks", { ...common, method: "POST", body: payload }),
    onSuccess: (task) => {
      notify("Tarea creada.");
      setDetailCache(task);
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: statsKey });
    }
    // Sin onError: el formulario muestra el error inline.
  });

  const updateTask = useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Partial<TaskFormPayload> }) =>
      apiRequest<TaskDetail>(`/tasks/${taskId}`, { ...common, method: "PATCH", body: patch }),
    onSuccess: (task) => {
      setDetailCache(task);
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      // Reasignar cambia de quién es la tarea: los recuentos por persona se
      // mueven aunque la etapa no cambie.
      void queryClient.invalidateQueries({ queryKey: statsKey });
    },
    onError
  });

  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      apiRequest<TaskDetail>(`/tasks/${taskId}/status`, {
        ...common,
        method: "PATCH",
        body: { status }
      }),
    // Optimista: la tarjeta cambia de columna al instante. Si el servidor
    // rechaza (por ejemplo un asesor intentando aprobar), vuelve sola.
    onMutate: ({ taskId, status }) => {
      const previous = queryClient.getQueryData<TaskListItem[]>(tasksKey);
      queryClient.setQueryData<TaskListItem[]>(tasksKey, (prev) =>
        prev ? prev.map((item) => (item.id === taskId ? { ...item, status } : item)) : prev
      );
      return { previous };
    },
    onSuccess: (task, { status }) => {
      setDetailCache(task);
      if (status === "finalizado") {
        notify("Tarea aprobada y archivada.");
        // Deja de existir para el tablero: se cierra el detalle si estaba abierto.
        setDetailTaskId((current) => (current === task.id ? null : current));
      }
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: ["tasks-archived", slug] });
      void queryClient.invalidateQueries({ queryKey: statsKey });
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(tasksKey, context.previous);
      onError(error);
    }
  });

  const unarchiveTask = useMutation({
    mutationFn: (taskId: string) =>
      apiRequest<TaskDetail>(`/tasks/${taskId}/status`, {
        ...common,
        method: "PATCH",
        body: { status: "en_proceso" }
      }),
    onSuccess: (task) => {
      notify("Tarea desarchivada: volvió a En proceso.");
      setDetailCache(task);
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: ["tasks-archived", slug] });
      void queryClient.invalidateQueries({ queryKey: statsKey });
    },
    onError
  });

  const deleteTask = useMutation({
    mutationFn: (taskId: string) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}`, { ...common, method: "DELETE" }),
    onSuccess: (_data, taskId) => {
      notify("Tarea eliminada.");
      queryClient.setQueryData<TaskListItem[]>(tasksKey, (prev) =>
        prev ? prev.filter((item) => item.id !== taskId) : prev
      );
      void queryClient.invalidateQueries({ queryKey: ["tasks-archived", slug] });
      void queryClient.invalidateQueries({ queryKey: statsKey });
    },
    onError
  });

  // Una actividad viaja completa: texto y archivos en una sola request, con
  // progreso real de subida.
  const addMessage = useMutation({
    mutationFn: ({ taskId, message, files }: { taskId: string; message: string; files: File[] }) => {
      setUploadProgress(files.length > 0 ? 0 : null);
      return apiUploadForm<unknown>(
        `/tasks/${taskId}/messages`,
        () => {
          const form = new FormData();
          if (message) form.set("message", message);
          for (const file of files) form.append("files", file);
          return form;
        },
        // Solo hay progreso que mostrar si viajan archivos.
        files.length > 0 ? { ...common, onProgress: setUploadProgress } : common
      );
    },
    onSettled: () => setUploadProgress(null),
    onSuccess: (_data, { taskId }) => invalidateTask(taskId),
    onError
  });

  const deleteMessage = useMutation({
    mutationFn: ({ taskId, messageId }: { taskId: string; messageId: string }) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}/messages/${messageId}`, {
        ...common,
        method: "DELETE"
      }),
    onSuccess: (_data, { taskId }) => invalidateTask(taskId),
    onError
  });

  const deleteAttachment = useMutation({
    mutationFn: ({ taskId, attachmentId }: { taskId: string; attachmentId: string }) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}/attachments/${attachmentId}`, {
        ...common,
        method: "DELETE"
      }),
    onSuccess: (_data, { taskId }) => invalidateTask(taskId),
    onError
  });

  const taskApi: TaskApi = {
    currentUserId,
    canModerate,
    isSaving: updateTask.isPending,
    isDeleting: deleteTask.isPending,
    isSendingMessage: addMessage.isPending,
    uploadProgress,
    deletingMessageId: deleteMessage.isPending ? deleteMessage.variables?.messageId ?? null : null,
    deletingAttachmentId: deleteAttachment.isPending
      ? deleteAttachment.variables?.attachmentId ?? null
      : null,
    movingTaskId: moveTask.isPending ? moveTask.variables?.taskId ?? null : null,
    onUpdate: (taskId, patch) => updateTask.mutateAsync({ taskId, patch }),
    onMove: (taskId, status) => moveTask.mutateAsync({ taskId, status }),
    onDelete: (taskId) => deleteTask.mutateAsync(taskId),
    onSendMessage: (taskId, message, files) => addMessage.mutateAsync({ taskId, message, files }),
    onDeleteMessage: (taskId, messageId) => deleteMessage.mutateAsync({ taskId, messageId }),
    onDeleteAttachment: (taskId, attachmentId) =>
      deleteAttachment.mutateAsync({ taskId, attachmentId })
  };

  const allTasks = tasksQuery.data ?? NO_TASKS;
  const allMembers = members.data ?? NO_MEMBERS;
  const detailFallback = detailTaskId
    ? allTasks.find((task) => task.id === detailTaskId) ?? null
    : null;

  const filtered = useMemo(
    () =>
      sortTasksByDueDate(
        allTasks.filter((task) => matchesTaskFilters(task, filters, currentUserId))
      ),
    [allTasks, filters, currentUserId]
  );

  const grouped = useMemo(() => {
    const byStatus = new Map<TaskStatus, TaskListItem[]>(
      TASK_BOARD_STATUSES.map((status) => [status, [] as TaskListItem[]])
    );
    for (const task of filtered) {
      byStatus.get(task.status)?.push(task);
    }
    return byStatus;
  }, [filtered]);

  const counts = useMemo(() => {
    const result = {} as Record<TaskStatus, number>;
    for (const status of Object.keys(TASK_STATUS_META) as TaskStatus[]) {
      result[status] = grouped.get(status)?.length ?? 0;
    }
    return result;
  }, [grouped]);

  const visibleCount = isWide ? filtered.length : counts[activeStatus];

  if (isArchivedOpen) {
    return (
      <div className="sp-page flush sp-task-page">
        <ArchivedTasksPanel
          common={common}
          currentUserId={currentUserId}
          canModerate={canModerate}
          totalCount={archivedCount}
          isUnarchiving={unarchiveTask.isPending}
          onBack={() => setIsArchivedOpen(false)}
          onOpen={(task) => setDetailTaskId(task.id)}
          onUnarchive={(taskId) => unarchiveTask.mutateAsync(taskId)}
        />

        <TaskDetailModal
          taskId={detailTaskId}
          fallback={detailFallback}
          common={common}
          members={allMembers}
          clients={clients}
          policies={policies}
          api={taskApi}
          onClose={() => setDetailTaskId(null)}
        />
      </div>
    );
  }

  return (
    <div className="sp-page flush sp-task-page">
      <TaskFilterBar
        filters={filters}
        members={allMembers}
        currentUserId={currentUserId}
        resultCount={visibleCount}
        archivedCount={archivedCount}
        onChange={setFilters}
        onCreate={() => setIsCreateOpen(true)}
        onOpenArchived={() => setIsArchivedOpen(true)}
      />

      {/* En pantalla angosta el kanban no entra: se navega por estado. */}
      {!isWide ? (
        <TaskStatusTabs
          value={activeStatus}
          counts={counts}
          canModerate={canModerate}
          onChange={setActiveStatus}
        />
      ) : null}

      <div className="sp-board-area">
        {tasksQuery.error ? <ErrorState text={tasksQuery.error.message} /> : null}
        {tasksQuery.isLoading ? <LoadingState text="Cargando tareas" /> : null}

        {!tasksQuery.isLoading && !tasksQuery.error ? (
          isWide ? (
            <TaskBoard
              tasksByStatus={grouped}
              canModerate={canModerate}
              movingTaskId={taskApi.movingTaskId}
              onOpen={(task) => setDetailTaskId(task.id)}
              onMove={(taskId, status) => moveTask.mutate({ taskId, status })}
            />
          ) : (
            <TaskList
              tasks={grouped.get(activeStatus) ?? NO_TASKS}
              status={activeStatus}
              canModerate={canModerate}
              movingTaskId={taskApi.movingTaskId}
              hasFilters={hasActiveTaskFilters(filters)}
              onOpen={(task) => setDetailTaskId(task.id)}
              onMove={(taskId, status) => moveTask.mutate({ taskId, status })}
              onClearFilters={() => setFilters(EMPTY_TASK_FILTERS)}
            />
          )
        ) : null}
      </div>

      <TaskFormModal
        isOpen={isCreateOpen}
        members={allMembers}
        clients={clients}
        policies={policies}
        currentUserId={currentUserId}
        isCreating={createTask.isPending}
        onClose={() => setIsCreateOpen(false)}
        onCreate={(payload) => createTask.mutateAsync(payload)}
      />

      <TaskDetailModal
        taskId={detailTaskId}
        fallback={detailFallback}
        common={common}
        members={allMembers}
        clients={clients}
        policies={policies}
        api={taskApi}
        onClose={() => setDetailTaskId(null)}
      />
    </div>
  );
}
