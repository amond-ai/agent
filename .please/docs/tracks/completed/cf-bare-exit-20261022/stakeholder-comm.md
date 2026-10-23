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

## Resolution

Hello. The problem you reported has been fixed. Here is a summary.

**What was wrong:** Running a command on a Cloudflare sandbox did not report its exit code when the command ended with a bare `exit` and a code, such as `echo before; exit 3`. Running the command failed with an error. Starting it and waiting for it never finished unless you had set a time limit. The same thing happened with a few other commands that end the shell early, such as a failing step under `set -e` or a command with a syntax error.

**How we fixed it:** Each command on a Cloudflare sandbox now runs in its own shell, as it does on a local sandbox. A command that ends with `exit N` now reports exit code `N` and its output, whether you run it or start it and wait for it.

**How to check it:** Run `echo before; exit 3` on a Cloudflare sandbox. It reports exit code 3 and the output `before`, and the next command on the same sandbox runs normally. We confirmed this on a real Cloudflare container.

**One change to be aware of:** Because each command now runs in its own shell, a `cd` or an `export` in one command no longer carries over to the next command on a Cloudflare sandbox. This matches a local sandbox. To set a working directory or environment variables, pass them with each command.

**Release status:** The fix is in pull request #53, which is in review. It ships once the pull request is merged.

Sorry for the trouble this caused. Let us know if you see anything else that doesn't work as expected. Thank you.
