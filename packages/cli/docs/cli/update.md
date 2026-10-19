---
title: amond update
description: Reference for fetching a blueprint guide that brings an existing integration up to the current version.
lastReviewedAt: 2026-07-21
---

## Synopsis

```bash
amond update <kind> <name|url> [--print]
```

## Description

`amond update` fetches the Markdown implementation guide for a blueprint, for piping to a coding agent that will bring an existing integration up to the current blueprint version. The command does not inspect or modify your project — the guide carries the update instructions, including how to compare the existing integration against the current blueprint and preserve customizations.

[`amond add`](/docs/cli/add/) emits the same guide; the two commands differ only in intent and argument handling (`amond update` requires both arguments, while `amond add` alone lists the catalog). Output behavior matches `amond add`: the guide prints to stdout for coding agents or with `--print`. Like `amond add`, it fetches from `https://blueprints.amond.ai` unless `AMOND_REGISTRY_URL` names another registry.

## Arguments

| Argument      | Description                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `<kind>`      | The integration category: `channel`, `database`, `sandbox`, or `tooling`.                                                |
| `<name\|url>` | A blueprint name matched within the kind, or an absolute URL to provider documentation for the build-from-scratch guide. |

## Options

| Option    | Description                                                                  |
| --------- | ---------------------------------------------------------------------------- |
| `--print` | Write the blueprint Markdown to stdout regardless of coding-agent detection. |

## Examples

```bash
amond update sandbox daytona --print | claude
amond update tooling braintrust --print | codex
amond update sandbox @cloudflare/computer --print | opencode
amond update channel https://developers.notion.com/reference/webhooks --print | claude
```
