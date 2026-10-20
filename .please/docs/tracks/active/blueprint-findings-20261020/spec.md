# Bug Fix: defects in the imported Flue blueprints

> Track: blueprint-findings-20261020
> Investigation: [investigation.md](./investigation.md)
> Issue: [#37](https://github.com/amond-ai/agent/issues/37)

## Overview

`amond add <blueprint>` gives a coding agent a blueprint to follow, and the agent writes that
blueprint's code into the user's project. #35 imported Flue's sandbox and tooling blueprints, and
review found 23 defects in them; Codex rated one of them P1. The investigation checked each one
against the SDK it targets:

- 22 are real.
- 1 is declined because its suggested fix breaks the sandbox contract.
- A 24th defect turned up along the way: the vitest-evals install step pulls a library version
  the blueprint's code no longer compiles against.
- A 25th turned up during the fix: the Mirage install step pins an older library version than
  the one the adapter was checked against, and the adapter does not compile against it.

Every defect came from Flue's own text, which has not changed upstream since the import. Without
a fix, an agent following these blueprints writes code that does one of these:

- fails to compile or import;
- runs a command in the wrong directory;
- reports a failed command as successful;
- hangs past its deadline;
- hides the cause of an error.

This track fixes the confirmed defects here. It records each change so a later sync from Flue
keeps it, and drafts a report for Flue for each defect. The user files those reports.

## Reproduction

1. Follow a named blueprint, for example `amond add exedev`, in a TypeScript project with `strict`
   enabled.
2. Use the code it writes the way the blueprint describes. For example, run a command with both a
   working directory that does not exist and an environment variable.

**Expected**: the generated code compiles, and every operation either does what the blueprint
says or fails with the real cause.

**Actual**: the result depends on the blueprint and is listed per finding in investigation.md
Section 3. For example, the exe.dev command runs in the login directory and reports success.

## Root Cause

The blueprints are instructions plus code samples that nothing compiles or runs. The repository
checks only their structure, so the defects came in unchanged from Flue `deee93b`. See
investigation.md Section 2.

## Requirements

### Functional Requirements

- [ ] FR-1: make the exe.dev adapter stop a command when its working directory cannot be entered,
  fail a directory creation that did not succeed, and treat a command that ends without an exit
  status, including one killed by a signal, as a failure. Its wiring examples also check required
  settings before use.
- [ ] FR-2: make the Cloudflare blueprint's container image example match the package version the
  blueprint installs, and wire the sandbox the way the deployment guide does, without a module the
  blueprint never creates.
- [ ] FR-3: make the Cloudflare Computer adapter cancel a command whose caller gave up before the
  command started returning.
- [ ] FR-4: make the Mirage blueprint install every package its code imports. Its adapter also
  keeps directory entries that end in a slash, removes files and directories with the `recursive`
  and `force` options as the sandbox contract requires, and reports the actual cause when a
  removal fails.
- [ ] FR-5: make the vitest-evals blueprint compile under `strict`, install a version of the eval
  library its code works with, target the port the dev server serves, and run its starter eval
  without failing when the agent reports no token usage.
- [ ] FR-6: make the boxd adapter's readiness check give up when its time budget runs out, even
  when a probe never answers, and probe again after an earlier probe failed.
- [ ] FR-7: make the islo adapter reject an environment variable name that is not a valid shell
  name, and write files larger than the system's single-argument limit.
- [ ] FR-8: make the Modal adapter's file-status error carry the system's reason, and its comment
  describe what the code does.
- [ ] FR-9: make the Daytona blueprint's two examples create the sandbox the same way.
- [ ] FR-10: describe the generic sandbox blueprint's `'use agent'` placement as the scanner
  accepts it, which is anywhere in the directive prologue.
- [ ] FR-11: raise the version of each blueprint whose generated code or install steps change, so
  an existing user's agent can find and apply the upgrade from the blueprint's Upgrade Guide.
- [ ] FR-12: record every change from Flue `deee93b` next to the blueprints, so a later sync from
  Flue does not silently undo it.
- [ ] FR-13: state the amond changes accurately in the registry's attribution footer and notice,
  including that blueprints were corrected, not only renamed and trimmed.
- [ ] FR-14: prepare one report per affected blueprint for the user to file with Flue. Each report
  gives the defect, a reproduction and the fix applied here.
- [ ] FR-15: answer every finding on #37 with its outcome: fixed, with where; or declined, with
  the reason.

## Acceptance Criteria

- [ ] AC-001 (FR-1): If an exe.dev command is given a working directory that does not exist, with
  or without environment variables and with one or several statements, then the adapter shall
  return a failing exit code without running the command.
- [ ] AC-002 (FR-1): If the exe.dev connection reports no exit status for a command, or reports
  that a signal ended it, then the adapter shall not report exit code 0.
- [ ] AC-003 (FR-1): If a recursive directory creation fails in the exe.dev sandbox, then the
  adapter shall reject with the command's error output.
- [ ] AC-004 (FR-1): When the exe.dev wiring examples are compiled under `strict`, the compiler
  shall report no errors.
- [ ] AC-005 (FR-2): The Cloudflare blueprint shall not reference a project module that none of
  its steps creates.
- [ ] AC-006 (FR-3): If the caller cancels a Cloudflare Computer command while the command is
  starting, then the adapter shall reject with an abort error and stop the command.
- [ ] AC-007 (FR-4): When the Mirage install steps are followed with a strict package manager, the
  blueprint's own type-check step shall pass.
- [ ] AC-008 (FR-4): When a Mirage directory listing returns `/data/sub/`, the adapter shall list
  `sub`.
- [ ] AC-009 (FR-4): If a Mirage file removal fails for a reason other than the path being a
  directory, then the adapter shall report that reason.
- [ ] AC-010 (FR-4): When Mirage removal is asked to `force`-remove a missing path, the adapter
  shall succeed.
- [ ] AC-020 (FR-4): If Mirage removal is asked to remove a missing path with `recursive` alone,
  then the adapter shall fail.
- [ ] AC-011 (FR-5): When the vitest-evals harness and starter eval are compiled under `strict`
  against the library version the blueprint installs, the compiler shall report no errors.
- [ ] AC-012 (FR-5): If the agent under evaluation attaches no token usage, then the starter eval
  shall not fail on a usage assertion.
- [ ] AC-013 (FR-6): If a boxd readiness probe never answers, then the readiness check shall fail
  once its time budget, plus at most one poll interval, has passed.
- [ ] AC-014 (FR-6): If a boxd readiness check failed earlier, then the next sandbox request on
  the same factory shall probe again.
- [ ] AC-015 (FR-7): If an islo command is given an environment variable named `X=1; echo hi; Y`,
  then the adapter shall reject it before running anything.
- [ ] AC-016 (FR-7): When an islo file of 200 KB is written, the adapter shall write it intact.
- [ ] AC-017 (FR-8): If Modal file status is requested for a missing path, then the error shall
  include the system's "No such file or directory" reason.
- [ ] AC-018 (FR-11): When a changed blueprint is read by the CLI's blueprint index and the
  registry build, both shall accept it.
- [ ] AC-021 (FR-11): When a blueprint's version is raised, its Upgrade Guide shall contain an
  entry for the new version that shows the change as a diff against the previous version.
- [ ] AC-019 (FR-12): When a maintainer compares a blueprint with Flue `deee93b`, every difference
  other than the rename shall be listed in the change record.

## Out of Scope

- The declined Daytona finding: under the sandbox contract, `exists` never throws, so it keeps
  returning `false` for a provider error. investigation.md Section 3, #15.
- A permanent check that compiles and runs every blueprint sample against its SDK. It would
  prevent a recurrence, but it is its own design decision.
- Porting the vitest-evals harness to the library's current API (0.17). This track pins the
  version it was written for.
- Filing the reports with Flue. The user does that.
- The patterns in investigation.md Section 5 that review did not flag.
- The docs-page findings tracked in #38.

## Assumptions

- The investigation checks reproduce each defect against the SDK version the blueprint installs.
  Live provider accounts (exe.dev, Daytona, boxd, islo, Modal, Cloudflare) were not used.
- Two behaviors stay unverified: whether BusyBox accepts the single `stat -c` call, and whether
  Mirage's shell `rm` matches Node's removal semantics exactly. The fixes rely only on documented
  behavior.
- The registry is not live yet, because the deploy is waiting on secrets. Fixing the text before
  the first successful deploy means users never receive the defective versions.
