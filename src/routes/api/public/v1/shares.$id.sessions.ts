import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { createSharedSession } from "@/server/shares/handlers";
export const Route = createFileRoute("/api/public/v1/shares/$id/sessions")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => createSharedSession(request, params.id),
    },
  },
});
