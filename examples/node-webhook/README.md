# Node webhook sample (Node 20+)

Run from the repository root:

```sh
BP_PHONE_ORIGIN=https://phone.example.com npm run webhook:example
```

Expose port 3000 through your HTTPS reverse proxy/tunnel. Unsigned **pairing only** logs the eight-character code and performs no outbound work. Register and verify, then restart with the registration's signing secret in `BP_SIGNING_SECRET` and the exact HTTPS phone origin (no trailing slash) in `BP_PHONE_ORIGIN`. Every non-pairing event requires that secret; absent or malformed signatures return 401. Keep secrets in the deployment secret manager, never source control or URL queries.

Callbacks must match the configured origin and `/api/public/v1/sessions/{session_id}/messages` exactly; queries, fragments, credentials and redirects are rejected. Request bytes are capped at 16 KB. Malformed JSON and delayed reply failures are caught. Optional ElevenLabs credentials: `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on this server only.

```sh
npm test -- src/test/node-example.test.ts
npm run check:webhook -- https://your-webhook "$BP_SIGNING_SECRET" "$BP_PHONE_ORIGIN"
```

The checker uses a valid-shaped fake session and callback token at your configured phone origin. Its deliberately nonexistent session returns 401/404 to the delayed callback; the sample catches that error and stays running. No request goes to compat.invalid. Use a test deployment, not a production agent, because call.start may mint real voice credentials.

Production requires persistent deduplication and a queue/retry mechanism for asynchronous replies; this in-memory bounded sample is not a durable delivery service. Require independently enforced public-only egress at the proxy/container/network boundary, including DNS and IPv6. Browser Phone itself refuses outbound webhooks without `BP_PUBLIC_ONLY_EGRESS=enforced`; this is an operator attestation, not a firewall installer.
