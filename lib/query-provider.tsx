"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

export function QueryProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Los datos operativos (clientes, compañías, pólizas) cambian poco;
            // 60s evita refetches al remontar vistas. Cada query puede subir su
            // propio staleTime si lo necesita.
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      }),
    []
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
