# ADR-0002: Own the durable execution contract, adapt to each platform

## Status

Accepted

## Date

2026-09-15

## Context

The first-class execution models for this framework are **schedule- and event-driven agents** and
**long-lived durable sessions** — an agent that pauses for an approval, waits on a webhook, and
resumes days later. Neither is a single request/response turn, so durability is not optional
infrastructure here; it is the execution model.

That collides with the goal of deploying equally well to Cloudflare and Vercel, because the two
platforms' durable primitives are not symmetric:

| | Cloudflare Workflows | Vercel Workflow |
| --- | --- | --- |
| Maturity | GA (2025-04) | Public Beta |
| Authoring | `WorkflowEntrypoint` class, `step.do()` | `"use workflow"` / `"use step"` directives |
| Build requirement | none — an ordinary class | **build-time code transformation** |
| Max duration | 365 days (Paid), 10,000 steps | no stated timeout |
| Region | global edge | `iad1` only |
| 1M steps | **$0.10** | $25 |
| Runtime swap | none (Cloudflare-only) | **Worlds** adapters (Vercel/Postgres/Local; Cloudflare in progress) |

Two asymmetries decide this. Vercel already treats portability as its own problem — the Worlds
adapter model exists precisely so a workflow can run somewhere else. But its directives require a
bundler transform, so adopting the SDK means this framework reaches into its users' build
pipeline. Cloudflare Workflows demands nothing of the build but runs only on Cloudflare.

Adopting either one directly makes it the framework's public API, and inherits whatever that
platform does next.

## Decision Drivers

- Schedule- and event-driven agents and long-lived durable sessions are the first-class execution
  models, not later additions.
- Cloudflare and Vercel must be equally deployable; neither may become a second-class target.
- No build-time code transformation may be imposed on a consumer's bundler.
- No platform's beta status or roadmap may become this framework's public API.

## Decision

Define a minimal durable contract in agent terms — start a turn, resume it, wait for an event,
record the outcome — and ship platform adapters behind it. This is the same seam the sandbox layer
already uses: `@amond-ai/sandbox` declares a contract and e2b, Cloudflare and local processes each
satisfy it.

Three implementations:

1. **in-memory** — the reference implementation and the test double; also what `amond dev` runs.
2. **Cloudflare Workflows** — the first production adapter, because it is GA, runs 365 days, and
   costs 250x less per step.
3. **Vercel Workflow** — a later adapter, written against the SDK's public API rather than its
   directives, so no build transform is imposed on users.

The contract is deliberately narrower than either platform's surface. It expresses what an agent
session needs and nothing else; anything a platform offers beyond that stays reachable through an
escape hatch rather than being lifted into the contract.

## Consequences

### Positive

- Neither platform's beta status nor its roadmap becomes this framework's public API.
- Users' build pipelines stay untouched — no directive transform is required to run an agent.
- `amond dev` runs the full durable model locally with no cloud account, because the in-memory
  adapter is a first-class implementation rather than a mock.
- The contract is testable on its own; an adapter is verified against one shared suite.

### Negative

- We write and maintain the adapters, and each platform's changes are our maintenance burden.
- The contract will be narrower than what either platform can do. Users who need Cloudflare's
  instance management or Vercel's `DurableAgent` reach past us or go without.
- A wrong abstraction here is expensive — the contract is load-bearing for every agent, and
  changing it after 1.0 breaks all of them.

### Neutral

- Adding a third backend later (Temporal, Postgres-backed, plain queues) is adapter work rather
  than a redesign.
- If Vercel's Cloudflare World ships and proves solid, our Vercel adapter may end up thinner than
  planned — the contract does not have to change for that to be true.

## Alternatives Considered

- **Adopt the Vercel Workflow SDK directly**: delegates portability to Vercel's Worlds model and
  brings `DurableAgent` along. Rejected on two counts — it is Public Beta, and its directives
  require build-time transformation, so an OSS framework adopting it forces that transform on
  every consumer's bundler. Adoption resistance is high and the failure mode is confusing.
- **Cloudflare Workflows as the first-class model, Vercel as an adapter later**: fastest path to a
  working product and the cheapest runtime by a wide margin. Rejected because it makes Vercel a
  second-class citizen, abandoning the equal-portability claim that is part of why this framework
  exists.
- **Leave durability out of the first release**: smallest scope; users call our handlers inside
  their own workflow. Rejected because durable sessions and scheduled triggers are the first-class
  execution models — deferring them defers the product.

## References

- [Cloudflare Workflows — limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Vercel Workflow — understanding directives](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/how-it-works/understanding-directives.mdx)
- [Vercel — a new programming model for durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution) — the Worlds adapter model
- ADR-0001 (0001-filesystem-first-agent-definition.md) — schedules and channels are the entry points this contract backs

---

**Created**: 2026-09-15
**Author**: Minsu Lee
**Last Updated**: 2026-09-15
