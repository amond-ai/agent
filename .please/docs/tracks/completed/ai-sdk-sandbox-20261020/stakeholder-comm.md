## Acknowledgment

Hello. We have picked up your request and scoped it as follows.

**Request**: Make the agent framework's sandbox usable directly as an AI SDK sandbox session, so
that the framework's own tools and the AI SDK harness can share one sandbox.

**Current status**: Scoped and specified. This track covers the agent package in this
repository. The Cloudflare sandbox package for the harness repository moves to a separate issue
there.

**Impact**: This is a breaking change to the sandbox API. Commands run through the AI SDK's
`run` and `spawn` instead of `exec`, and file reads and writes use the AI SDK's method names.
Existing sandbox adapters keep working without changes. Nothing is published yet, so no released
version is affected.

**Next steps**: We will write the implementation plan, then build and test the change on all
three built-in sandboxes (local, in-memory, and Cloudflare). This unblocks running agent turns
through the AI SDK harness (#17).

Let us know if anything here does not match what you expected. Thank you.

## Resolution

Hello. The change you requested is implemented and ready for review.

**What was missing**: The agent framework's sandbox had its own interface, so the AI SDK harness
could not use it directly. Running agent turns through the harness would have needed a second,
separate sandbox.

**What we changed**: The sandbox is now an AI SDK sandbox session. The framework's own tools and
the AI SDK harness can use the same sandbox. All three built-in sandboxes (local, in-memory, and
Cloudflare) support the AI SDK's `run` and `spawn` commands and its file methods. On the local
and Cloudflare sandboxes, a spawned command's output streams as it is produced instead of
arriving all at once at the end.

**What to expect**: This is the breaking change described when we picked up the request. Commands
use `run` and `spawn` instead of `exec`, and file reads and writes use the AI SDK's method names.
Existing sandbox adapters keep working without changes. One known limit: on Cloudflare, stopping a
spawned command releases the caller at once, but the command itself keeps running in the
container. Stopping it for real is planned as a follow-up.

**Release status**: Pull request #44 is in review. The change ships once it is merged; nothing is
published yet.

Let us know if anything here does not match what you expected. Thank you.
