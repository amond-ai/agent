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
