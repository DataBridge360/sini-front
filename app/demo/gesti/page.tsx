import type { Metadata } from "next";
import { AIAssistantInterface } from "@/components/ui/ai-assistant-interface";

// Demo pública de Gesti: el mismo chat del CRM, sin sesión ni backend (las
// respuestas son guiones de ejemplo). Sirve para probar el flujo completo.
export const metadata: Metadata = {
  title: "Gesti · Demo",
  robots: { index: false, follow: false }
};

export default function GestiDemoPage() {
  return (
    <main className="gesti-demo-page">
      <AIAssistantInterface userName="Lucas" />
    </main>
  );
}
