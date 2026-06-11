"use client";

import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Task } from "@/lib/api";
import { capitalizeFirst } from "@/lib/format";
import { TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/tasks";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function toISODate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function priorityDot(priority: Task["priority"]) {
  return TASK_PRIORITIES.find((item) => item.key === priority)?.dot ?? "#94a3b8";
}

export function TaskCalendar({ tasks, onOpenTasks }: { tasks: Task[]; onOpenTasks: () => void }) {
  const todayIso = toISODate(new Date());
  const [cursor, setCursor] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const [selectedDay, setSelectedDay] = useState(todayIso);

  // due_date llega como "YYYY-MM-DD" (columna date): se agrupa por string directo.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.due_date || task.status === "finalizado") continue;
      const list = map.get(task.due_date) ?? [];
      list.push(task);
      map.set(task.due_date, list);
    }
    return map;
  }, [tasks]);

  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(cursor)
  );

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    // Semana es-AR: arranca en lunes.
    const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: Array<{ iso: string; day: number } | null> = [];
    for (let index = 0; index < firstOffset; index += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push({ iso: toISODate(new Date(year, month, day)), day });
    }
    return result;
  }, [cursor]);

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const next = new Date(current);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  };

  const selectedTasks = tasksByDay.get(selectedDay) ?? [];
  const selectedLabel = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${selectedDay}T00:00:00`)
    )
  );

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--org-primary-soft)] text-[var(--org-primary)]">
            <CalendarDays size={15} />
          </span>
          <h2 className="m-0 text-sm font-bold text-slate-900">Calendario de tareas</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mes anterior"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-32 text-center text-[13px] font-semibold text-slate-700">{monthLabel}</span>
          <button
            type="button"
            aria-label="Mes siguiente"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {label}
          </span>
        ))}
        {cells.map((cell, index) =>
          cell ? (
            <button
              key={cell.iso}
              type="button"
              className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-[12px] font-semibold transition-colors ${
                selectedDay === cell.iso
                  ? "bg-[var(--org-primary)] text-white"
                  : cell.iso === todayIso
                    ? "bg-[var(--org-primary-soft)] text-[var(--org-primary)]"
                    : "text-slate-600 hover:bg-slate-100"
              }`}
              onClick={() => setSelectedDay(cell.iso)}
            >
              {cell.day}
              <span className="absolute bottom-1 flex gap-0.5">
                {(tasksByDay.get(cell.iso) ?? []).slice(0, 3).map((task) => (
                  <i
                    key={task.id}
                    className="h-1 w-1 rounded-full"
                    style={{
                      backgroundColor: selectedDay === cell.iso ? "rgba(255,255,255,0.9)" : priorityDot(task.priority)
                    }}
                  />
                ))}
              </span>
            </button>
          ) : (
            <span key={`empty-${index}`} />
          )
        )}
      </div>

      <div className="mt-4 flex min-h-24 flex-1 flex-col gap-1.5 border-t border-slate-100 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{selectedLabel}</span>
        {selectedTasks.length === 0 ? (
          <p className="m-0 py-3 text-center text-[12px] text-slate-400">Sin tareas con vencimiento este día.</p>
        ) : (
          selectedTasks.slice(0, 4).map((task) => {
            const column = TASK_COLUMNS.find((item) => item.key === task.status);
            return (
              <button
                key={task.id}
                type="button"
                className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 text-left transition-colors hover:border-slate-200 hover:bg-slate-50"
                onClick={onOpenTasks}
              >
                <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: priorityDot(task.priority) }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-700">{task.title}</span>
                <span className="shrink-0 text-[10.5px] font-medium text-slate-400">{column?.label}</span>
              </button>
            );
          })
        )}
        {selectedTasks.length > 4 ? (
          <button
            type="button"
            className="flex items-center justify-center gap-1 text-[12px] font-semibold text-[var(--org-primary)]"
            onClick={onOpenTasks}
          >
            Ver {selectedTasks.length - 4} más
            <ArrowUpRight size={12} />
          </button>
        ) : null}
      </div>
    </article>
  );
}
