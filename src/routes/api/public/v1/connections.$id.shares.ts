import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { createShare, listShares } from "@/server/shares/handlers";
export const Route = createFileRoute("/api/public/v1/connections/$id/shares")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => listShares(request, params.id),
      POST: ({ request, params }) => createShare(request, params.id),
    },
  },
});
