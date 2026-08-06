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
import { useRef, useState } from "react";
import type { TaskListItem, TaskStatus } from "@/lib/api";
import { useDeferRealtime } from "@/lib/realtime";
import { canTransitionStatus, TASK_BOARD_STATUSES, TASK_STATUS_META } from "@/lib/tasks";
import { TaskCardContent } from "@/components/tasks/task-card";

const NO_TASKS: TaskListItem[] = [];

// Kanban de escritorio. Tres columnas: pendiente, en proceso y en revisión.
//
// No hay columna "finalizado" a propósito: aprobar archiva la tarea, y una
// tarjeta que se esfuma al soltarla sería un antipatrón. Aprobar y rechazar son
// siempre botones explícitos dentro de la tarjeta.
export function TaskBoard({
  tasksByStatus,
  canModerate,
  movingTaskId,
  onOpen,
  onMove
}: {
  tasksByStatus: Map<TaskStatus, TaskListItem[]>;
  canModerate: boolean;
  movingTaskId: string | null;
  onOpen: (task: TaskListItem) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
}) {
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);
  // 6px de tolerancia: el click sigue abriendo el detalle, arrastrar mueve.
  const dragHappenedRef = useRef(false);

  // Mientras se arrastra una tarjeta no entra ningún refresco: si la lista se
  // reordenara bajo el puntero, la tarjeta saltaría de lugar a mitad del gesto.
  useDeferRealtime(activeTask !== null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const releaseDragFlag = () => {
    window.setTimeout(() => {
      dragHappenedRef.current = false;
    }, 50);
  };

  const handleDragStart = (event: DragStartEvent) => {
    dragHappenedRef.current = true;
    const all = [...tasksByStatus.values()].flat();
    setActiveTask(all.find((task) => task.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragged = activeTask;
    setActiveTask(null);
    releaseDragFlag();

    const status = event.over?.id as TaskStatus | undefined;
    if (!dragged || !status || dragged.status === status) return;
    // Doble llave: los destinos inválidos ya no aceptan drop, pero si algo se
    // escapa el backend responde 403 y la card volvería sola.
    if (!canTransitionStatus(dragged.status, status, canModerate)) return;

    onMove(dragged.id, status);
  };

  const handleOpen = (task: TaskListItem) => {
    if (dragHappenedRef.current) return;
    onOpen(task);
  };

  return (
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
        {TASK_BOARD_STATUSES.map((status) => (
          <TaskColumn
            key={status}
            status={status}
            tasks={tasksByStatus.get(status) ?? NO_TASKS}
            activeTask={activeTask}
            canModerate={canModerate}
            movingTaskId={movingTaskId}
            onOpen={handleOpen}
            onMove={onMove}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <article className="sp-task-card sp-task-card-dragging">
            <TaskCardContent task={activeTask} canModerate={canModerate} isMoving={false} />
          </article>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TaskColumn({
  status,
  tasks,
  activeTask,
  canModerate,
  movingTaskId,
  onOpen,
  onMove
}: {
  status: TaskStatus;
  tasks: TaskListItem[];
  activeTask: TaskListItem | null;
  canModerate: boolean;
  movingTaskId: string | null;
  onOpen: (task: TaskListItem) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
}) {
  const meta = TASK_STATUS_META[status];
  // Durante un arrastre, una columna a la que esta tarea no puede ir se atenúa y
  // deja de aceptar el drop: mejor decir "acá no" antes de soltar que fallar
  // después.
  const isValidTarget =
    !activeTask || activeTask.status === status || canTransitionStatus(activeTask.status, status, canModerate);
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !isValidTarget });

  return (
    <section
      ref={setNodeRef}
      data-drop={isOver && isValidTarget ? "on" : undefined}
      className={`sp-kanban-column sp-task-column border-t-[3px] ${
        activeTask && !isValidTarget ? "opacity-45" : ""
      }`}
      style={{ borderTopColor: meta.dot }}
    >
      <header>
        <div className="min-w-0">
          <i className="shrink-0" style={{ backgroundColor: meta.dot }} />
          <h3 className="shrink-0">{meta.label}</h3>
          <em className="ml-1 hidden truncate text-[11px] font-normal not-italic text-slate-400 min-[1100px]:inline">
            {meta.hint}
          </em>
        </div>
        <span
          className="shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.dot} 16%, transparent)`, color: meta.dot }}
        >
          {tasks.length}
        </span>
      </header>

      <div className="sp-kanban-scroll">
        {tasks.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center">
            <span className="text-[12px] text-slate-400">
              {status === "revision" ? "Nada esperando aprobación" : "Arrastrá una tarea acá"}
            </span>
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard
              key={task.id}
              task={task}
              canModerate={canModerate}
              isMoving={movingTaskId === task.id}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableTaskCard({
  task,
  canModerate,
  isMoving,
  onOpen,
  onMove
}: {
  task: TaskListItem;
  canModerate: boolean;
  isMoving: boolean;
  onOpen: (task: TaskListItem) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
}) {
  // Un asesor no puede sacar una tarea de revisión, así que tampoco puede
  // arrastrarla: el cursor lo dice antes de intentarlo.
  const isLocked = !canModerate && task.status === "revision";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: isLocked });

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`sp-task-card ${isLocked ? "sp-task-card-locked" : "sp-task-card-draggable"} ${
        isDragging ? "opacity-40" : ""
      }`}
      title={isLocked ? "Esperando aprobación: solo un productor puede moverla." : undefined}
      onClick={() => onOpen(task)}
    >
      <TaskCardContent
        task={task}
        canModerate={canModerate}
        isMoving={isMoving}
        onMove={(status) => onMove(task.id, status)}
      />
    </article>
  );
}
