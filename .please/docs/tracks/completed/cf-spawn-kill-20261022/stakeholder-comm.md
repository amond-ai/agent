## Acknowledgment

Hello. We have received your report, and this is how we understand it.

**What you reported**: On a Cloudflare sandbox, stopping a running command releases your code at once, but the command itself keeps running in the container until it finishes on its own or times out. The same happens when a command is stopped because it produced too much unread output.

**Current status**: Reproduced. We confirmed it on a real Cloudflare container and with an automated test.

**Impact**: A command you stop, such as a long loop or a server, keeps using the container and can keep changing files there after you have moved on. Commands on the local and in-memory sandboxes are not affected.

**Next steps**: We will make stopping a command on Cloudflare actually stop it in the container. That covers stopping it directly, cancelling it, hitting the output limit, and reaching its time limit. Before release we will check this on a real container. We will follow up when the fix is ready for review.

Let us know if any of this does not match what you saw. Thank you.

## Resolution

Hello. The issue you reported has been fixed, and here is what changed.

**What was wrong**: On a Cloudflare sandbox, stopping a running command released your code at once, but nothing told the container to stop the command, so it kept running there until it finished or timed out. The same happened when a command was stopped for producing too much unread output or for running past its time limit.

**How it was fixed**: Stopping a command on a Cloudflare sandbox now stops it in the container, together with any processes it started. This covers stopping it directly, cancelling it, hitting the output limit, and reaching its time limit. Waiting for the result still returns at once when you stop a command, and a command that runs past its time limit now reports exit code 124.

**What to expect**: Start a long-running command, such as a loop that writes a line to a file every second, and stop it after a few seconds. The file stops growing. We checked stopping it directly, cancelling it, and the time limit on a real Cloudflare container; automated tests cover the output limit. A Cloudflare sandbox set up without the SDK's process controls behaves as before.

**Release status**: The fix is in PR #51, which is in review. It will be released after it merges.

We are sorry for the trouble. Let us know if you see anything else. Thank you.
