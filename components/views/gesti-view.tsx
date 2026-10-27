"use client";

import { useMemo, useState } from "react";
import { AIAssistantInterface } from "@/components/ui/ai-assistant-interface";
import { authStorage } from "@/lib/api";
import { createGestiApiBackend } from "@/lib/gesti-api";
import { createDemoBackend } from "@/lib/gesti-demo";
import type { Tab } from "@/lib/shell-types";

// Gesti en el CRM: el chat vive en `AIAssistantInterface` (también lo usa la
// demo pública); acá solo se le conecta la API, el nombre del usuario y la
// navegación. Los chats se guardan en el server, separados por usuario.
export function GestiView({
  userName,
  organizationSlug,
  canSeeUsage,
  onNavigate
}: {
  userName: string;
  organizationSlug: string | undefined;
  /** Productor o admin de plataforma: ve el consumo del mes. */
  canSeeUsage: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  // El token se renueva con la sesión: el backend lo lee del almacenamiento de
  // la sesión en cada pedido, así no se recrea (recrearlo volvería a pedir la
  // lista de chats) y nunca usa uno vencido.
  const backend = useMemo(
    () =>
      createGestiApiBackend({
        getAuth: () => ({ token: authStorage.read()?.accessToken, organizationSlug }),
        canSeeUsage
      }),
    [organizationSlug, canSeeUsage]
  );

  return (
    <AIAssistantInterface
      // Otra organización es otro historial: se monta de cero.
      key={organizationSlug ?? "none"}
      userName={userName}
      backend={backend}
      onNavigate={onNavigate}
      usageScope={organizationSlug ?? "none"}
    />
  );
}

// Demo pública: mismo chat, respuestas guionadas en memoria y sin sesión.
export function GestiDemoView({ userName }: { userName: string }) {
  const [backend] = useState(createDemoBackend);
  return <AIAssistantInterface userName={userName} backend={backend} />;
}
