import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { revokeConnection } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/connections/$id/revoke")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => revokeConnection(request, params.id),
    },
  },
});
