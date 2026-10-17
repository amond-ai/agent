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
