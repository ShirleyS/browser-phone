import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { postAppMessage, listMessages } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/sessions/$id/messages")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => postAppMessage(request, params.id),
      GET: ({ request, params }) => listMessages(request, params.id),
    },
  },
});
