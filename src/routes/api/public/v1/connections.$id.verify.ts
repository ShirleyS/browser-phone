import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { verifyConnection } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/connections/$id/verify")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) => verifyConnection(request, params.id),
    },
  },
});
