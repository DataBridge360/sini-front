import { handleTaskAttachmentsCleanup } from "@/server/modules/tasks/attachment-cleanup";

// Lo dispara el Cron de Vercel (vercel.json) una vez por día.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleTaskAttachmentsCleanup(request);
}
