# amond

The command-line interface for amond agent projects: scaffold a project and run an agent locally.
Blueprint guides and documentation pages are available through `amond add`, `amond update`, and `amond docs`.

```sh
npm install --save-dev amond
```

## Commands

| Command                              | Description                                                 |
| ------------------------------------ | ----------------------------------------------------------- |
| `amond init [directory]`             | Initialize a new amond project (interactive).               |
| `amond run <path> -m <text>`         | Run one agent module locally, print its reply, then exit.   |
| `amond add [kind] [name\|url]`       | Fetch a blueprint implementation guide.                     |
| `amond update <kind> <name\|url>`    | Fetch an updated blueprint implementation guide.            |
| `amond docs`                         | List the documentation pages.                               |
| `amond docs read <page>`             | Print one documentation page.                               |
| `amond docs search <query>`          | Search the documentation.                                   |

`amond docs` reads the pages bundled in the package. `amond add` and `amond update` fetch blueprint text
from `https://blueprints.amond.ai`. Set `AMOND_REGISTRY_URL` to fetch from another registry instead, for
example `AMOND_REGISTRY_URL=http://127.0.0.1:8787 amond add sandbox daytona --print`. Trailing slashes are
ignored, and the registry must serve `<slug>.md` files.

```sh
amond init ./my-agent-app
cd my-agent-app
amond run src/agents/hello.ts -m "Hi there"
amond run src/agents/hello.ts -m "And then?" --id support-4821
```

`amond run` accepts `--name`, `--id`, `--uid`, `--new`, `--data`, `--json`, and `--env`.
Run `amond --help` for the full list.

Dev servers and production builds belong to Vite. Use `vite dev` and `vite build` with the
`amond()` plugin from [`@amond-ai/agent-vite`](../agent-vite).

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
