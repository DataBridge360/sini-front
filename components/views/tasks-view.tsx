"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText, MessageSquare, Paperclip, Plus, Search, User, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  apiRequest,
  apiUpload,
  type ApiCommonOptions,
  type Client,
  type OrganizationMember,
  type Policy,
  type Task,
  type TaskAttachment,
  type TaskFormPayload,
  type TaskMessage,
  type TaskStatus
} from "@/lib/api";
import { formatDate, getDaysUntilDue, initials } from "@/lib/format";
import { compressAttachment } from "@/lib/media";
import {
  EMPTY_TASK_FILTERS,
  matchesTaskFilters,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  type TaskFilters
} from "@/lib/tasks";
import { PriorityChip, type TaskApi } from "@/components/tasks/shared";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { ErrorState, LoadingState } from "@/components/ui/states";

const NO_TASKS: Task[] = [];
const NO_MEMBERS: OrganizationMember[] = [];

export function TasksView({
  common,
  currentUserId,
  canModerate,
  clients,
  policies,
  notify
}: {
  common: ApiCommonOptions;
  currentUserId: string;
  canModerate: boolean;
  clients: Client[];
  policies: Policy[];
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const queryClient = useQueryClient();
  const slug = common.organizationSlug ?? "";
  const tasksKey = ["tasks", slug];

  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const dragHappenedRef = useRef(false);

  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: () => apiRequest<Task[]>("/tasks", common),
    // Con el detalle abierto se refresca seguido para que el chat se sienta vivo.
    refetchInterval: detailTaskId ? 15_000 : false
  });

  const members = useQuery({
    queryKey: ["organization-members", slug],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<OrganizationMember[]>("/organizations/current/members", common)
  });

  const patchTaskInCache = (task: Task) => {
    queryClient.setQueryData<Task[]>(tasksKey, (prev) =>
      prev ? prev.map((item) => (item.id === task.id ? task : item)) : prev
    );
  };

  const mutateTaskInCache = (taskId: string, mutate: (task: Task) => Task) => {
    queryClient.setQueryData<Task[]>(tasksKey, (prev) =>
      prev ? prev.map((item) => (item.id === taskId ? mutate(item) : item)) : prev
    );
  };

  const onError = (error: Error) => notify(error.message, "error");

  const createTask = useMutation({
    mutationFn: (payload: TaskFormPayload) =>
      apiRequest<Task>("/tasks", { ...common, method: "POST", body: payload }),
    onSuccess: (task) => {
      notify("Tarea creada.");
      queryClient.setQueryData<Task[]>(tasksKey, (prev) => (prev ? [task, ...prev] : prev));
      void queryClient.invalidateQueries({ queryKey: tasksKey });
    }
    // Sin onError: el formulario muestra el error inline.
  });

  const updateTask = useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Partial<TaskFormPayload> }) =>
      apiRequest<Task>(`/tasks/${taskId}`, { ...common, method: "PATCH", body: patch }),
    onSuccess: patchTaskInCache,
    onError
  });

  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      apiRequest<Task>(`/tasks/${taskId}/status`, { ...common, method: "PATCH", body: { status } }),
    // Optimista: la tarjeta cambia de columna al soltar, sin esperar al servidor.
    onMutate: ({ taskId, status }) => {
      const previous = queryClient.getQueryData<Task[]>(tasksKey);
      mutateTaskInCache(taskId, (task) => ({ ...task, status }));
      return { previous };
    },
    onSuccess: patchTaskInCache,
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKey, context.previous);
      }
      onError(error);
    }
  });

  const deleteTask = useMutation({
    mutationFn: (taskId: string) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}`, { ...common, method: "DELETE" }),
    onSuccess: (_data, taskId) => {
      notify("Tarea eliminada.");
      queryClient.setQueryData<Task[]>(tasksKey, (prev) =>
        prev ? prev.filter((item) => item.id !== taskId) : prev
      );
    },
    onError
  });

  const addMessage = useMutation({
    mutationFn: ({ taskId, message }: { taskId: string; message: string }) =>
      apiRequest<TaskMessage>(`/tasks/${taskId}/messages`, { ...common, method: "POST", body: { message } }),
    onSuccess: (message, { taskId }) => {
      mutateTaskInCache(taskId, (task) => ({ ...task, messages: [...(task.messages ?? []), message] }));
    },
    onError
  });

  const deleteMessage = useMutation({
    mutationFn: ({ taskId, messageId }: { taskId: string; messageId: string }) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}/messages/${messageId}`, { ...common, method: "DELETE" }),
    onSuccess: (_data, { taskId, messageId }) => {
      mutateTaskInCache(taskId, (task) => ({
        ...task,
        messages: (task.messages ?? []).filter((message) => message.id !== messageId)
      }));
    },
    onError
  });

  const uploadAttachment = useMutation({
    // Las imágenes se comprimen en el navegador antes de viajar (ver lib/media).
    mutationFn: async ({ taskId, file }: { taskId: string; file: File }) =>
      apiUpload<TaskAttachment>(`/tasks/${taskId}/attachments`, await compressAttachment(file), common),
    onSuccess: (attachment, { taskId }) => {
      notify("Archivo adjuntado.");
      mutateTaskInCache(taskId, (task) => ({
        ...task,
        attachments: [...(task.attachments ?? []), attachment]
      }));
    },
    onError
  });

  const deleteAttachment = useMutation({
    mutationFn: ({ taskId, attachmentId }: { taskId: string; attachmentId: string }) =>
      apiRequest<{ ok: boolean }>(`/tasks/${taskId}/attachments/${attachmentId}`, { ...common, method: "DELETE" }),
    onSuccess: (_data, { taskId, attachmentId }) => {
      mutateTaskInCache(taskId, (task) => ({
        ...task,
        attachments: (task.attachments ?? []).filter((attachment) => attachment.id !== attachmentId)
      }));
    },
    onError
  });

  const taskApi: TaskApi = {
    currentUserId,
    canModerate,
    isSaving: updateTask.isPending,
    isDeleting: deleteTask.isPending,
    isSendingMessage: addMessage.isPending,
    isUploading: uploadAttachment.isPending,
    deletingMessageId: deleteMessage.isPending ? deleteMessage.variables?.messageId ?? null : null,
    deletingAttachmentId: deleteAttachment.isPending ? deleteAttachment.variables?.attachmentId ?? null : null,
    onUpdate: (taskId, patch) => updateTask.mutateAsync({ taskId, patch }),
    onDelete: (taskId) => deleteTask.mutateAsync(taskId),
    onSendMessage: (taskId, message) => addMessage.mutateAsync({ taskId, message }),
    onDeleteMessage: (taskId, messageId) => deleteMessage.mutateAsync({ taskId, messageId }),
    onUploadAttachment: (taskId, file) => uploadAttachment.mutateAsync({ taskId, file }),
    onDeleteAttachment: (taskId, attachmentId) => deleteAttachment.mutateAsync({ taskId, attachmentId })
  };

  const allTasks = tasksQuery.data ?? NO_TASKS;
  const allMembers = members.data ?? NO_MEMBERS;
  const detailTask = detailTaskId ? allTasks.find((task) => task.id === detailTaskId) ?? null : null;

  const filtered = useMemo(
    () => allTasks.filter((task) => matchesTaskFilters(task, filters, currentUserId)),
    [allTasks, filters, currentUserId]
  );

  const grouped = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>(TASK_COLUMNS.map((column) => [column.key, []]));
    for (const task of filtered) {
      byStatus.get(task.status)?.push(task);
    }
    return byStatus;
  }, [filtered]);

  const sensors = useSensors(
    // 6px de tolerancia: el click sigue abriendo el detalle, arrastrar mueve.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    dragHappenedRef.current = true;
    setActiveTask(allTasks.find((task) => task.id === event.active.id) ?? null);
  };

  const releaseDragFlag = () => {
    window.setTimeout(() => {
      dragHappenedRef.current = false;
    }, 50);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    releaseDragFlag();
    const status = event.over?.id as TaskStatus | undefined;
    const task = allTasks.find((item) => item.id === event.active.id);
    if (task && status && task.status !== status) {
      moveTask.mutate({ taskId: task.id, status });
    }
  };

  const openDetail = (task: Task) => {
    if (dragHappenedRef.current) return;
    setDetailTaskId(task.id);
  };

  return (
    <div className="sp-page flush">
      <FiltersPanel
        filters={filters}
        members={allMembers}
        onChange={setFilters}
        onCreate={() => setIsCreateOpen(true)}
      />

      <div className="sp-board-toolbar">
        <span>{tasksQuery.isLoading ? "Cargando..." : `${filtered.length} ${filtered.length === 1 ? "tarea" : "tareas"}`}</span>
      </div>

      <div className="sp-board-area">
        {tasksQuery.error ? <ErrorState text={tasksQuery.error.message} /> : null}
        {tasksQuery.isLoading ? <LoadingState text="Cargando tareas" /> : null}
        {!tasksQuery.isLoading ? (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setActiveTask(null);
              releaseDragFlag();
            }}
          >
            <div className="sp-kanban sp-kanban-flow">
              {TASK_COLUMNS.map((column) => (
                <TaskColumn
                  key={column.key}
                  column={column}
                  tasks={grouped.get(column.key) ?? NO_TASKS}
                  onOpen={openDetail}
                />
              ))}
            </div>
            <DragOverlay>
              {activeTask ? (
                <article className="rotate-2 cursor-grabbing rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl">
                  <TaskCardContent task={activeTask} />
                </article>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </div>

      <TaskFormModal
        isOpen={isCreateOpen}
        members={allMembers}
        clients={clients}
        policies={policies}
        isCreating={createTask.isPending}
        onClose={() => setIsCreateOpen(false)}
        onCreate={(payload) => createTask.mutateAsync(payload)}
      />

      <TaskDetailModal
        task={detailTask}
        members={allMembers}
        clients={clients}
        policies={policies}
        api={taskApi}
        onClose={() => setDetailTaskId(null)}
      />
    </div>
  );
}

function FiltersPanel({
  filters,
  members,
  onChange,
  onCreate
}: {
  filters: TaskFilters;
  members: OrganizationMember[];
  onChange: (filters: TaskFilters) => void;
  onCreate: () => void;
}) {
  const hasFilters = filters.search !== "" || filters.priority !== "all" || filters.assignee !== "all";

  const update = (key: keyof TaskFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="sp-filters">
      <div className="sp-search">
        <Search size={15} />
        <input
          placeholder="Tarea, asegurado, póliza N°..."
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
        />
      </div>
      <select value={filters.priority} onChange={(event) => update("priority", event.target.value)}>
        <option value="all">Todas las prioridades</option>
        {TASK_PRIORITIES.map((priority) => (
          <option key={priority.key} value={priority.key}>
            Prioridad {priority.label.toLowerCase()}
          </option>
        ))}
      </select>
      <select value={filters.assignee} onChange={(event) => update("assignee", event.target.value)}>
        <option value="all">Todos los asignados</option>
        <option value="me">Mis tareas</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.full_name}
          </option>
        ))}
      </select>
      {hasFilters ? (
        <button className="sp-clear-filter" type="button" onClick={() => onChange(EMPTY_TASK_FILTERS)}>
          <X size={14} />
          Limpiar
        </button>
      ) : null}
      <button type="button" className="sp-primary-action ml-auto" onClick={onCreate}>
        <Plus size={14} />
        Nueva tarea
      </button>
    </div>
  );
}

function TaskColumn({
  column,
  tasks,
  onOpen
}: {
  column: (typeof TASK_COLUMNS)[number];
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <section
      ref={setNodeRef}
      className={`sp-kanban-column border-t-[3px] transition-shadow ${
        isOver ? "shadow-[inset_0_0_0_2px_var(--org-primary)]" : ""
      }`}
      style={{ borderTopColor: column.dot }}
    >
      <header>
        <div className="min-w-0">
          <i className="shrink-0" style={{ backgroundColor: column.dot }} />
          <h3 className="shrink-0">{column.label}</h3>
          <em className="ml-1 hidden truncate text-[11px] font-normal not-italic text-slate-400 min-[1100px]:inline">
            {column.hint}
          </em>
        </div>
        <span
          className="shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${column.dot} 16%, transparent)`, color: column.dot }}
        >
          {tasks.length}
        </span>
      </header>
      <div className="sp-kanban-scroll">
        {tasks.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center">
            <span className="text-[12px] text-slate-400">Arrastrá una tarea acá</span>
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)
        )}
      </div>
    </section>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
      onClick={() => onOpen(task)}
    >
      <TaskCardContent task={task} />
    </article>
  );
}

function TaskCardContent({ task }: { task: Task }) {
  const days = task.due_date ? getDaysUntilDue(task.due_date) : null;
  const dueChip =
    task.status === "finalizado"
      ? "bg-slate-100 text-slate-400"
      : days !== null && days < 0
        ? "bg-red-50 text-red-700"
        : days !== null && days <= 3
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";
  const messageCount = task.messages?.length ?? 0;
  const attachmentCount = task.attachments?.length ?? 0;

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-slate-900">{task.title}</h4>
        <PriorityChip priority={task.priority} />
      </div>

      {task.due_date || task.clients || task.policies ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {task.due_date ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${dueChip}`}>
              <CalendarDays size={10.5} className="shrink-0" />
              {days !== null && days < 0 && task.status !== "finalizado" ? "Venció el " : ""}
              {formatDate(task.due_date)}
            </span>
          ) : null}
          {task.clients ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[color:var(--org-primary-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--org-primary)]">
              <User size={10.5} className="shrink-0" />
              <span className="truncate">{task.clients.full_name}</span>
            </span>
          ) : null}
          {task.policies ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
              <FileText size={10.5} className="shrink-0" />
              <span className="truncate">#{task.policies.policy_number}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
        {task.assigned_to ? (
          <span className="flex min-w-0 items-center gap-1.5" title={`Asignada a ${task.assigned_to.full_name}`}>
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[color:var(--org-primary)] text-[9px] font-bold text-white">
              {initials(task.assigned_to.full_name)}
            </span>
            <span className="truncate text-[11px] font-medium text-slate-600">{task.assigned_to.full_name}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300">
              <User size={11} />
            </span>
            Sin asignar
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] font-medium text-slate-400">
          {messageCount > 0 ? (
            <span className="flex items-center gap-0.5">
              <MessageSquare size={11} />
              {messageCount}
            </span>
          ) : null}
          {attachmentCount > 0 ? (
            <span className="flex items-center gap-0.5">
              <Paperclip size={11} />
              {attachmentCount}
            </span>
          ) : null}
        </span>
      </div>
    </>
  );
}
