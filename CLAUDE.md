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
