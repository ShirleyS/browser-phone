# Node webhook sample (Node 20+)

Run from the repository root:

```sh
PORT=3001 BP_PHONE_ORIGIN=https://phone.example.com npm run webhook:example
```

Expose port 3001 through your HTTPS reverse proxy/tunnel. Unsigned **pairing only** logs the eight-character code and performs no outbound work. Register and verify, then restart with the registration's signing secret in `BP_SIGNING_SECRET` and the exact HTTPS phone origin (no trailing slash) in `BP_PHONE_ORIGIN`. Every non-pairing event requires that secret; absent or malformed signatures return 401. Keep secrets in the deployment secret manager, never source control or URL queries.

Callbacks must match the configured origin and `/api/public/v1/sessions/{session_id}/messages` exactly; queries, fragments, credentials and redirects are rejected. Request bytes are capped at 16 KB. Malformed JSON and delayed reply failures are caught. For private ElevenLabs voice, set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in this webhook server’s secret settings. They belong to the integration owner, including when someone else uses a shared test link. A `call.start` event makes the sample request a temporary signed URL and return it to the phone. Live audio then connects directly between the browser and ElevenLabs. See [voice setup](../../docs/VOICE.md).

```sh
npm test -- src/test/node-example.test.ts
npm run check:webhook -- https://your-webhook "$BP_SIGNING_SECRET" "$BP_PHONE_ORIGIN"
```

The phone server can run on port 3000 while this example uses port 3001. Give each its appropriate public HTTPS address, and keep `BP_PHONE_ORIGIN` set to the phone’s origin.

The checker uses a valid-shaped fake session and callback token at your configured phone origin. Its deliberately nonexistent session returns 401/404 to the delayed callback; the sample catches that error and stays running. No request goes to compat.invalid. Use a test deployment, not a production agent, because call.start may mint real voice credentials.

Production requires persistent deduplication and a queue/retry mechanism for asynchronous replies; this in-memory bounded sample is not a durable delivery service. Require independently enforced public-only egress at the proxy/container/network boundary, including DNS and IPv6. Browser Phone enables outbound delivery through its pinned Node startup or an independently verified egress policy. `BP_PUBLIC_ONLY_EGRESS=enforced` is an operator attestation, not a firewall installer; leave it unset for the pinned Node path.
