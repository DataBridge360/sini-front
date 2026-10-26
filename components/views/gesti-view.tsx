"use client";

import { AIAssistantInterface } from "@/components/ui/ai-assistant-interface";
import type { Tab } from "@/lib/shell-types";

// Gesti en el CRM: el chat vive en `AIAssistantInterface` (también lo usa la
// demo pública); acá solo se le conecta el nombre del usuario y la navegación.
export function GestiView({ userName, onNavigate }: { userName: string; onNavigate: (tab: Tab) => void }) {
  return <AIAssistantInterface userName={userName} onNavigate={onNavigate} />;
}
