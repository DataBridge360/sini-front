import type { Metadata } from "next";
import { GestiDemoView } from "@/components/views/gesti-view";

// Demo pública de Gesti: el mismo chat del CRM, sin sesión ni API (las
// respuestas son guiones de ejemplo en memoria). Sirve para probar el flujo completo.
export const metadata: Metadata = {
  title: "Gesti · Demo",
  robots: { index: false, follow: false }
};

export default function GestiDemoPage() {
  return (
    <main className="gesti-demo-page">
      <GestiDemoView userName="Lucas" />
    </main>
  );
}
