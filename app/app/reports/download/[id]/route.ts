import { openExportDownload } from "@/lib/server/services/exports";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}

/**
 * Authenticated CSV download for one of the signed-in user's exports, from R2 or local disk. The bucket
 * is private, so this route is the only way to fetch an export; another user's id answers 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return text(401, "Sign in to download this export.");
  }
  const { id } = await params;
  const result = await openExportDownload(user.id, id);
  if (!result.ok) {
    return text(result.status, result.message);
  }
  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
