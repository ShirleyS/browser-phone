# Share a test phone

Connect and verify your own webhook in Live mode, then open **Share a test phone**. Choose **1 call**, **3 calls**, **5 calls**, or **Custom** (1–100 call attempts), and an expiry of one hour,24hours or seven days. Copy the newly created link and send it to a tester. No signup is needed. Their calls and messages use your existing webhook and provider integration; your permanent ElevenLabs key stays on your server.

The link opens a phone-only page. Each tester gets separate sessions and inboxes. Opening or reloading the link uses no calls. Starting a new call reserves one slot; an attempt still counts if the microphone/provider fails afterward. Retrying the same session request does not count twice. Everyone with the same link shares its **total lifetime allowance**, including people it is forwarded to. The existing20sessions per webhook per UTC day, concurrency and call-duration rules still apply. Link expiry cannot outlive the connection credential. At most20active links per connection are allowed.

Owner listings show usage, expiry and revoke controls; the raw link token is returned only once. Copy it when created. If it is lost, revoke the old link and create another. Removing a saved MojoAuth setup does not revoke test links; revoke the link or use Forget connection for that. Account signout clears the owner's tab and does not revoke links shared with other people.

The share token is random and stored only as a hash on the server. In a test URL it is placed in the fragment (`#key=…`), which is not sent as part of the HTTP page request. The test page removes it from the address bar after reading it and keeps it in that tab's sessionStorage for reloads. Anyone holding the original full link can forward it and use its remaining allowance. Keep it private when appropriate. Tester storage is separate from the owner's connection and preferences, including when both pages are opened in the same browser tab.

The API returns only contact/display number, language and allowance to testers. It never returns the owner connection capability, webhook signing secret or provider API key. Session phone tokens are scoped to each private session. Requests after link/connection revocation or expiry are rejected, including inbox and callbacks; active clients end audio on their next poll/deadline. Shared call-start IDs are canonicalized so changing an event ID cannot mint another voice credential from one reserved session.

The count limits Browser Phone **call starts**, not every possible provider connection. A previously issued provider URL remains governed by the provider, and cannot be recalled by this app. Use provider controls for an absolute provider budget. Normal audio goes directly between the browser and provider.

## Deployment

Apply the generated Drizzle0006migration after0000–0005 to the isolated Browser Phone database. No additional provider key or MojoAuth account is required for sharing. The existing safe outbound delivery requirement still applies; use the pinned Node startup for self-hosting or verify the actual hosted egress policy before enabling webhooks. Publish on HTTPS. Real paired delivery and provider audio must be verified on that deployment; local protocol and database tests do not establish a successful live call.
