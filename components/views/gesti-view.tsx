"use client";

import { AIAssistantInterface } from "@/components/ui/ai-assistant-interface";
import type { Tab } from "@/lib/shell-types";

// Gesti en el CRM: el chat vive en `AIAssistantInterface` (también lo usa la
// demo pública); acá solo se le conecta el nombre del usuario y la navegación.
// El historial de chats se guarda en el navegador, separado por usuario.
export function GestiView({
  userId,
  userName,
  onNavigate
}: {
  userId: string;
  userName: string;
  onNavigate: (tab: Tab) => void;
}) {
  return <AIAssistantInterface userName={userName} historyKey={userId} onNavigate={onNavigate} />;
}
