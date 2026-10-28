import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { createSession } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/connections/$id/sessions")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => createSession(request, params.id),
    },
  },
});
