"use client";

import { Bell, FilePlus2, ListPlus, Sparkles, UserPlus, type LucideIcon } from "lucide-react";

type QuickAction = { key: string; label: string; icon: LucideIcon; count?: number; onClick: () => void };

// Una fila de accesos: neutros, con el ícono en color de marca.
export function QuickActions({
  toContact,
  onNewTask,
  onNewPolicy,
  onNewClient,
  onOpenNotices,
  onOpenGesti
}: {
  toContact: number;
  onNewTask: () => void;
  onNewPolicy: () => void;
  onNewClient: () => void;
  onOpenNotices: () => void;
  onOpenGesti: () => void;
}) {
  const actions: QuickAction[] = [
    { key: "task", label: "Nueva tarea", icon: ListPlus, onClick: onNewTask },
    { key: "policy", label: "Nueva póliza", icon: FilePlus2, onClick: onNewPolicy },
    { key: "client", label: "Nuevo asegurado", icon: UserPlus, onClick: onNewClient },
    { key: "notices", label: "Avisos", icon: Bell, count: toContact, onClick: onOpenNotices },
    { key: "gesti", label: "Gesti", icon: Sparkles, onClick: onOpenGesti }
  ];

  return (
    <nav className="db-quick" aria-label="Accesos rápidos">
      {actions.map(({ key, label, icon: Icon, count, onClick }) => (
        <button key={key} type="button" onClick={onClick}>
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          {count ? (
            <b aria-label={`${count} a contactar`}>{count}</b>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
