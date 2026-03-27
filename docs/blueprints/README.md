# Resevia — Living Blueprints

This folder is the project's institutional memory. Every time something is learned, broken, fixed, or decided — it gets recorded here. These files are updated alongside the codebase, not after.

## Files

| File | What it covers |
|---|---|
| [architecture.md](architecture.md) | System design, data model, multi-tenant rules, booking flow |
| [agent.md](agent.md) | Prompt engineering, tool design, what works / what doesn't |
| [integrations.md](integrations.md) | Cal.com, Twilio, Supabase, Gemini — quirks and working patterns |
| [failures.md](failures.md) | Bugs hit, root causes, fixes — so we don't repeat them |

## How to use this

- **Before building anything new** — read the relevant file first. The answer might already be here.
- **After fixing a bug** — add it to `failures.md` immediately.
- **After a decision is made** — add the reasoning to `architecture.md` or `agent.md`.
- **After a QA run** — cross-reference results with `agent.md` and update if behaviour changed.

QA reports live in `docs/qa-report-YYYY-MM-DD.md` and are linked from `failures.md` where relevant.
