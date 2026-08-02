@AGENTS.md

# Project Rules

## Third-party SDKs: use the vendor's code, don't reimplement it

Do NOT hand-roll logic that a vendor SDK already provides (signature
verification, signing, auth flows, pagination, retries, etc.). If the installed
version of an SDK lacks the function we need, find and pin the version that
ships it rather than writing your own implementation.

- **Retell webhook verification** uses `Retell.verify(body, apiKey, signature)`
  from `retell-sdk`. This helper was removed after **5.9.0**, so the package is
  pinned to an exact `5.9.0` (no caret — a range drifts to 5.40+ which dropped
  it). The signing secret is the **Retell API key** with the webhook badge;
  there is no separate webhook secret. `verifyRetellSignature` in
  `src/lib/retell.ts` is a thin async wrapper around it.
- **Stripe webhook verification** must use `stripe.webhooks.constructEvent`.
  Never compare signatures by hand.

## Source control workflow

Agreed 2026-07-30. Follow this for every change without being asked.

**Trunk-based, short-lived branches.** `main` is always deployable. Everything
else is a branch measured in days, never weeks. Prefix `feat/`, `fix/`, `docs/`,
`chore/`, `refactor/` plus a short slug.

**Never commit directly to `main`.** Branch, PR, merge — even for a one-line fix.

**Commits are atomic**; one reviewable idea each. The diff shows _what_; the
message must carry _why_, because that is the part which cannot be reconstructed
later. Several commits per PR is correct and makes `git bisect` useful.

**One PR is one reviewable idea that leaves `main` deployable.** A delivery
phase is not a PR — phases split by layer: migration+types → backend → UI →
enablement.

**Do not squash-merge.** Revised 2026-07-31. Merge with `--no-ff` and keep the
individual commits. Each commit's message carries the _why_ for one decision, and
that reasoning is the part which cannot be reconstructed from the diff — squashing
destroys exactly the thing atomic commits exist to preserve, and replaces a dozen
specific explanations with one summary nobody can act on. `git log main
--first-parent` still reads as one entry per feature because of the merge commit,
and `git revert -m 1` on that commit is just as trivial as reverting a squash.

**PR descriptions state the problem, not the solution.** Describe what was
broken or missing and why it mattered; the diff explains the implementation.

**Migrations are forward-only and immutable.** Once a migration has run anywhere
real, never edit it — add a new one. Sequentially numbered, one concern per file.
This is the single most important rule for keeping the database evolvable.

**Feature flags for anything spanning more than one PR**, so incomplete work
lives on `main` behind a switch instead of on a long-lived branch.

**Hotfix path:** `fix/` branch off `main`, minimal diff, straight out, tests
backfilled immediately after. Kept distinct from feature work so an incident
never waits on a phase.

**Tag releases** (`vX.Y.Z`) once there are paying customers, so "what was running
when this business complained" is answerable.

**Docs are code.** The PRD/EDD lives in `docs/` and changes by PR like anything
else. `docs/Ringly_PRD_v3.md` (requirements) and `docs/Ringly_EDD_v3.md`
(engineering design) are current and are revised separately — they were one file
until 2026-08-01 and were split so each carries its own history. Earlier versions
are retained and marked superseded.
