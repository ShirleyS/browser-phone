import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { revokeShare } from "@/server/shares/handlers";
export const Route = createFileRoute("/api/public/v1/connections/$id/shares/$shareId/revoke")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => revokeShare(request, params.id, params.shareId),
    },
  },
});
