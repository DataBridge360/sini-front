import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getTabFromPathname } from "@/lib/shell-types";

export default async function ViewPage({
  params
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;

  if (!getTabFromPathname(`/${view}`)) {
    notFound();
  }

  return <AppShell />;
}
