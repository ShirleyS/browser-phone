import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/server/bp/core";
import { getSharedPhone } from "@/server/shares/handlers";
export const Route = createFileRoute("/api/public/v1/shares/$id")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getSharedPhone(request, params.id),
    },
  },
});
