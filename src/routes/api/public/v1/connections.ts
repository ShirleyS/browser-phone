import { createFileRoute } from "@tanstack/react-router";
import { preflight, json, liveCapability } from "@/server/bp/core";
import { createConnection } from "@/server/bp/handlers";

export const Route = createFileRoute("/api/public/v1/connections")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: () => json(liveCapability()),
      POST: ({ request }) => createConnection(request),
    },
  },
});
