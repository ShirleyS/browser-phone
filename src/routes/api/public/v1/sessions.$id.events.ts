import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { postEvent } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/sessions/$id/events")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => postEvent(request, params.id),
    },
  },
});
