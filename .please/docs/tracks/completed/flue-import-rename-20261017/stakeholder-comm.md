## Acknowledgment

Hello. We have picked up #20 and want to confirm how we understand it.

**Request**: Bring Flue's runtime, Vite plugin, CLI, SDK and React packages into this repository
with their history, renamed to amond, so that later phases (#15–#18) can build on them here.

**Current status**: Scoped and planned. The work is split in two: this track covers the code, the
toolchain and attribution; a second track brings in the docs pages and blueprints that
`amond docs`, `amond add` and `amond update` show.

**What changes for users**: Everything a user installs, imports, configures and runs carries the
amond name. Agents build the way they did under Flue, with `vite build`. Until the second track
lands, `amond docs`, `amond add` and `amond update` report that no content is bundled. The
current `amond` CLI package is retired, and the new CLI takes its name.

**One correction**: #20 says `amond build` should produce a Worker. Flue's CLI has no build
command, so done is checked with `vite build` instead. We will update #20 to match.

**Next steps**: Implement the import as a stack of pull requests, then open the second track for
the CLI content.

Let us know if any of this differs from what you expected. Thank you.

## Resolution

Hello. The code half of #20 is done and ready for review.

**What was needed**: Flue's runtime, Vite plugin, CLI, SDK and React packages had to come into
this repository with their history and carry the amond name, so the later phases (#15–#18) can
build on them here.

**What we did**: The five packages are now in this repository with their history, published as
`@amond-ai/agent`, `@amond-ai/agent-vite`, `amond`, `@amond-ai/agent-sdk` and
`@amond-ai/agent-react` (all 0.1.0). They build and test on this repository's tools.
Everything a user installs, imports, configures and runs uses the amond name, and the code
credits Flue as its source. Agents still build with `vite build`. The old `amond` CLI package is
retired, and the new CLI takes its name.

**What to expect**: `amond init` and `amond run` work. Until the second track brings in the docs
pages and blueprints, `amond docs`, `amond add` and `amond update` say that no content is
bundled with this version. They do not contact Flue's website. Nothing is published to npm yet.

**Status**: Pull requests #24, #25 and #27 are in review. They merge in that order, and #24
keeps Flue's history with a merge commit. The packages are not released yet.

**Still open**: #20's done criteria still say `amond build`; we will change them to
`vite build`. The second track, for the CLI's docs and blueprints, is not opened yet.

Thank you. Let us know if anything here differs from what you expected.
