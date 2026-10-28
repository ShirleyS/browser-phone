import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { getUsage } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/connections/$id/usage")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getUsage(request, params.id),
    },
  },
});
