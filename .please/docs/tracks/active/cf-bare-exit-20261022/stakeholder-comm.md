## Acknowledgment

Hello. We have received your report. Here is what we understood.

**What you reported:** On a Cloudflare sandbox, a command that ends with a bare `exit` and an exit code, such as `echo before; exit 3`, never reports that exit code:

- running the command fails with an error instead of returning exit code 3;
- starting the command and waiting for it never finishes unless you set a time limit.

The same command returns exit code 3 on a local sandbox.

**Current status:** We reproduced it on a real Cloudflare container and in an automated test. The next command on the same sandbox still runs normally.

**Impact and severity:** Medium. A command that ends this way can leave an agent waiting indefinitely, unless a time limit is set. Until the fix ships, you can avoid it by wrapping the command, for example `sh -c 'echo before; exit 3'`.

**What changes with the fix:** Each command will run in its own shell, as on a local sandbox. A variable that one command sets with `export` will therefore no longer be visible to the next command on a Cloudflare sandbox. Today it is visible there.

**Next steps:**

- We will fix it so that commands ending this way report their exit code and output on every kind of Cloudflare sandbox.
- We will confirm the fix on a real container.
- We will let you know when it is ready.

Let us know if anything above doesn't match what you saw. Thank you.
