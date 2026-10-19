## Acknowledgment

Hello. We've picked up the second half of #20. Here is how we understand it.

**What was asked**: `amond docs`, `amond add` and `amond update` exist in the `amond` CLI but only say that no content is bundled. This work brings in Flue's documentation pages and blueprints, under the amond name, so the three commands work.

**Current status**: The scope is defined and the plan is next. Nothing is built yet.

**Scope and impact**:
- `amond docs` will list, read and search the documentation from the terminal, even without a network connection.
- `amond add` and `amond update` will hand a coding agent a step-by-step guide for adding a sandbox provider or a tooling integration, or for building a channel or database adapter from scratch.
- Blueprint text will come from a site on an amond-owned domain, so a blueprint's text can be updated without a new CLI release. Adding a new blueprint still needs one.
- Content for Flue packages this repository did not bring in (channels, persistence adapters and OpenTelemetry) stays out, so no page will tell you to install a package that doesn't exist under the amond name.

**Next step**: We'll write the implementation plan, including the hostname for the blueprint site, and share it for approval before any work starts.

If any of this differs from what you expected, let us know. Thank you.

## Resolution

Hello. The second half of #20 is built and ready for review.

**What was wrong**: `amond docs`, `amond add` and `amond update` were in the `amond` CLI, but the documentation pages and blueprints they serve had not come over from Flue, so each command only said that no content was bundled.

**What we did**: The CLI now ships Flue's documentation pages under the amond name. The blueprints, which are step-by-step guides a coding agent follows, now live on a site the amond project runs, `blueprints.amond.ai`. Pages and blueprints for Flue packages this repository did not bring in (channels, persistence adapters and OpenTelemetry) are left out, so nothing tells you to install a package that doesn't exist under the amond name.

**What to expect**:
- `amond docs` lists, reads and searches the documentation from the terminal, even offline. For example, `amond docs read guide/tools` prints the tools guide.
- `amond add` lists the available sandbox and tooling blueprints, and the guides for building a channel or database adapter from scratch.
- `amond add sandbox daytona` hands your coding agent that blueprint's steps.
- Blueprint text can be updated on the site without a new CLI release. Adding a new blueprint still needs one.

**Release status**: The work is in review as PRs #33 and #35. It ships after they merge. The blueprint site goes live after its first deploy from `main`, so `amond add` and `amond update` can fetch blueprint text only from then on. `amond docs` works as soon as the change is released.

If anything here differs from what you expected, let us know. Thank you.
