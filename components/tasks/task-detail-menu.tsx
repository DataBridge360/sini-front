"use client";

import { MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Menú del encabezado: editar los datos y eliminar la tarea.
//
// Las dos acciones que cambian la tarea entera viven acá, fuera del camino de
// lectura. Eliminar queda separada por una línea y en rojo: es la única
// irreversible del modal.
export function TaskDetailMenu({
  isEditing,
  canDelete,
  onToggleEdit,
  onDelete
}: {
  isEditing: boolean;
  canDelete: boolean;
  onToggleEdit: () => void;
  onDelete: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Se corta acá para que Escape cierre el menú y no el modal entero.
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="sp-task-menu">
      <button
        type="button"
        className="sp-task-menu-trigger"
        aria-label="Acciones de la tarea"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <MoreVertical size={17} />
      </button>

      {isOpen ? (
        <div className="sp-task-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onToggleEdit();
            }}
          >
            {isEditing ? <X size={14} /> : <Pencil size={14} />}
            {isEditing ? "Terminar de editar" : "Editar datos"}
          </button>

          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setIsOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} />
              Eliminar tarea
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
