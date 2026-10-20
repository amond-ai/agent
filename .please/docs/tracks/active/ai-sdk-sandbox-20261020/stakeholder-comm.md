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
