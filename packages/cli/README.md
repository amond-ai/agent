# amond

The command-line interface for amond agent projects: scaffold a project, run an agent locally,
fetch implementation guides, and read the bundled docs.

```sh
npm install --save-dev amond
```

## Commands

| Command                              | Description                                                 |
| ------------------------------------ | ----------------------------------------------------------- |
| `amond init [directory]`             | Initialize a new amond project (interactive).               |
| `amond run <path> -m <text>`         | Run one agent module locally, print its reply, then exit.   |
| `amond add [kind] [name\|url]`       | Fetch a blueprint implementation guide. No arguments lists blueprints. |
| `amond update <kind> <name\|url>`    | Fetch an updated blueprint implementation guide.            |
| `amond docs`                         | List the documentation pages.                               |
| `amond docs read <page>`             | Print one documentation page.                               |
| `amond docs search <query>`          | Search the documentation.                                   |

```sh
amond init ./my-agent-app
amond run src/agents/hello.ts -m "Hi there"
amond run src/agents/hello.ts -m "And then?" --id support-4821
```

`amond run` accepts `--name`, `--id`, `--uid`, `--new`, `--json`, and `--env`.
Run `amond --help` for the full list.

Dev servers and production builds belong to Vite. Use `vite dev` and `vite build` with the
`amond()` plugin from [`@amond-ai/agent-vite`](../agent-vite).

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
