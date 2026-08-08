import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";

export const metadata: Metadata = {
  title: "Sinipro2",
  description: "Gestion multi-organizacion de polizas y avisos",
  applicationName: "SiniPro",
  // Hace que en iOS la app agregada a inicio abra sin la barra de Safari y con
  // el nombre corto debajo del ícono.
  // Los íconos salen de las convenciones de archivo de Next: app/icon.svg para
  // el favicon y app/apple-icon.png para el ícono de la pantalla de inicio de
  // iOS. Los del manifest (incluidos los maskable) viven en public/icons.
  appleWebApp: {
    capable: true,
    title: "SiniPro",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff"
};

// Chrome dispara `beforeinstallprompt` en cuanto decide que el sitio es
// instalable, que puede ser antes de que React monte. Este script inline corre
// durante el parseo del HTML, cancela el evento (si no, el navegador se lo
// guarda para el ícono de la barra de direcciones y no lo volvemos a ver) y lo
// deja disponible para el componente que muestra la oferta.
const CAPTURE_INSTALL_EVENT = `
window.__spInstallEvent = null;
window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  window.__spInstallEvent = event;
  window.dispatchEvent(new Event("sp:installavailable"));
});
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {/* `appleWebApp.capable` emite el nombre estandarizado
            `mobile-web-app-capable`. iOS anterior a 16.4 solo entiende el
            nombre viejo, y sin él la app agregada a inicio abre con la barra de
            Safari en vez de a pantalla completa. React lo iza al <head>. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: CAPTURE_INSTALL_EVENT }} />
        <ServiceWorkerRegistrar />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
