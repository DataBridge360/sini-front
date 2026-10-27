"use client";

import Image from "next/image";
import { Bell, FilePlus2, ListPlus, UserPlus, type LucideIcon } from "lucide-react";

type QuickAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  onClick: () => void;
};

// Accesos redondos, como las acciones de una billetera: sin bordes ni tarjeta.
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
    { key: "task", label: "Tarea", icon: ListPlus, onClick: onNewTask },
    { key: "policy", label: "Póliza", icon: FilePlus2, onClick: onNewPolicy },
    { key: "client", label: "Asegurado", icon: UserPlus, onClick: onNewClient },
    { key: "notices", label: "Avisos", icon: Bell, count: toContact, onClick: onOpenNotices },
    { key: "gesti", label: "Gesti", onClick: onOpenGesti }
  ];

  return (
    <nav className="db-quick" aria-label="Accesos rápidos">
      {actions.map(({ key, label, icon: Icon, count, onClick }) => (
        <button key={key} type="button" onClick={onClick}>
          <span className="db-quick-circle">
            {Icon ? (
              <Icon size={22} aria-hidden="true" />
            ) : (
              <Image src="/gesti/gesti-avatar.webp" alt="" width={40} height={40} />
            )}
            {count ? <b aria-label={`${count} a contactar`}>{count > 99 ? "99+" : count}</b> : null}
          </span>
          <span className="db-quick-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
