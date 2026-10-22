## Acknowledgment

Hello. We have received your report, and this is how we understand it.

**What you reported**: On a Cloudflare sandbox, stopping a running command releases your code at once, but the command itself keeps running in the container until it finishes on its own or times out. The same happens when a command is stopped because it produced too much unread output.

**Current status**: Reproduced. We confirmed it on a real Cloudflare container and with an automated test.

**Impact**: A command you stop, such as a long loop or a server, keeps using the container and can keep changing files there after you have moved on. Commands on the local and in-memory sandboxes are not affected.

**Next steps**: We will make stopping a command on Cloudflare actually stop it in the container. That covers stopping it directly, cancelling it, hitting the output limit, and reaching its time limit. Before release we will check this on a real container. We will follow up when the fix is ready for review.

Let us know if any of this does not match what you saw. Thank you.
