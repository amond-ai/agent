## Acknowledgment

Hello. We have received your report about the review findings on the imported blueprints, and
here is how we understand it.

**What was reported**: the code review of the sandbox and tooling blueprints left 23 findings.
These are the guides that `amond add` hands to a coding agent. Each finding says that following a
blueprint would produce code that is wrong in some way.

**Current status**: we checked every finding against the provider library it targets.

- 22 are real and reproduced.
- 1 is declined: its suggested change would break the documented contract that sandbox
  adapters follow.
- We also found one more problem: the eval blueprint installs a newer library version that its
  code no longer works with.

**Impact and severity**: someone who follows an affected blueprint can end up with code that does
one of the following:

- fails to compile or import;
- runs a command in the wrong directory and reports success;
- treats a failed command as successful;
- waits past its deadline;
- hides the real cause of an error.

The registry that serves these blueprints is not live yet, so no one has received them so far.

**Next steps**: we will correct the affected blueprints and raise their versions so existing
setups can upgrade. We will also record every change from the original text, and prepare a report
for each defect for the upstream project. We will reply on each finding with its outcome once the
fix is ready for review.

Let us know if anything here does not match what you meant. Thank you.

## Resolution

Hello. The problems you reported in the imported blueprints are fixed, and here is a summary.

**What was wrong**: following some of the guides that `amond add` hands to a coding agent produced
code that was wrong in one of these ways:

- it failed to compile or install;
- it ran a command in the wrong directory and reported success;
- it treated a failed command as successful;
- it waited past its deadline;
- it hid the real cause of an error.

Two more problems turned up during the work: two guides installed a library version their own code
no longer worked with.

**How it was fixed**: every confirmed problem is corrected. Each guide whose generated code changed
has a new version with upgrade instructions, so an existing setup can apply the change. One report
was declined because its suggested change would break the documented rule that sandbox adapters
follow. We have also prepared a report for the upstream project for each problem.

**How to check it**: after the fix ships, `amond add <kind> <name> --print` (for example
`amond add sandbox exedev --print`) prints the corrected guide, and `amond update <kind> <name>`
returns it with upgrade instructions for an existing integration. Code an agent writes from a corrected
guide compiles and reports failures with their real cause.

**Release status**: the fix is ready for review (pull requests #39, #40 and #42) and is not merged
yet. Once it is merged, the next registry deploy will serve the corrected guides. The registry is
not live yet, so no one has received the faulty versions.

Thank you for the detailed report. Let us know if you find anything else.
