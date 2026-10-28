# Share a test phone

Let a teammate or client test your integration without setting up credentials or creating an account. The person creating the link supplies the webhook and provider account; testers use that integration.

## Create a link

1. Connect and verify your webhook in **Connect → Live**.
2. Open **Share a test phone**.
3. Choose **1 call**, **3 calls**, **5 calls**, or **Custom** (1–100 total call attempts).
4. Set the expiry to **1 hour**, **24 hours**, or **7 days**.
5. Copy the new link and send it to your tester.

The full link is shown only when created. Copy it then. If you lose it or reload the setup page, revoke the old link and create another. The owner can list active links, see usage and revoke access. Up to 20 active links are allowed per connection.

The tester opens a phone-only page. Each tester gets separate sessions and inboxes; they cannot change the owner's setup or read another tester's conversation. Permanent ElevenLabs credentials stay on the owner's backend.

## How the allowance works

| Action | Uses a call slot? |
|---|---|
| Open or reload the test phone | No |
| Start a new call attempt | Yes, one |
| Retry the same session request after a network failure | No additional slot |
| A reserved attempt later fails because of microphone or provider setup | The slot remains used |
| Send a message in an existing chat session | No call slot |
| Forward the link to another person | They use the same remaining allowance |

The call allowance belongs to the **whole link for its lifetime**, not each tester or each day. A one-call link gives everyone holding it one call attempt in total. Messages remain available after call attempts are exhausted, until the link expires or is revoked, subject to the existing session limits.

The default **20 new sessions per webhook per UTC day**, concurrency limit and call-duration limit still apply. Chat and call sessions share that daily allowance. A link's custom allowance does not increase the deployment's daily limit. The link also cannot outlive the underlying webhook connection credential.

The count governs Browser Phone call starts. It does not override the voice provider's billing or invalidate a temporary provider credential already issued. See [voice and credential behavior](VOICE.md#shared-links-and-credentials).

## Forwarding, expiry and revocation

Anyone holding the full link can forward it and use its remaining allowance. No signup is required, so access is based on possession of that link rather than a named recipient.

Revoke the link from the setup screen to stop subsequent access. Revocation ends its attached Browser Phone sessions and releases their capacity. Requests after link or connection expiry/revocation are rejected, including inbox reads and reply callbacks; active clients end audio on their next poll or deadline.

**Forget connection** revokes the underlying connection. Removing an optional saved setup or signing out does not revoke links already shared with other people.

## What is in the link

The initial URL has the form `/test/{id}#key=…`. The capability is in the fragment, so it is not sent as part of the HTTP page request. The test page reads it, removes it from the address bar and keeps it in that tab's session storage for reloads. Send the original full link from the creator's Copy button; a URL copied from the tester's address bar after loading will not include the capability.

The server stores only a hash of the share token. Testers receive contact/display settings, language and allowance, plus private session capabilities when they interact. They do not receive the owner's connection token, webhook signing secret or provider API key. Tester storage is separate from the owner's connection and preferences.

## Deployment requirements

This feature is implemented in the source. To use it on a real deployment, apply [migration 0006](../drizzle/migrations/0006_shared_test_phones.sql) after the earlier migrations, configure the Live backend and publish over HTTPS. Follow the [Node hosting guide](../examples/node-host/README.md).

No additional provider key or MojoAuth account is needed for sharing. A current public deployment and end-to-end provider audio have not been verified; local tests do not establish a successful hosted call.
