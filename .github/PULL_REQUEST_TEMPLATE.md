# Summary

<!-- One or two sentences. What changed and why. -->

## Area

- [ ] packages/shared
- [ ] packages/sensors
- [ ] packages/llm
- [ ] packages/agents
- [ ] apps/api
- [ ] apps/web
- [ ] infra/terraform
- [ ] docs
- [ ] CI / tooling

## Checklist

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm -r test` passes (new tests added where applicable)
- [ ] `pnpm run build` passes
- [ ] If this touches a route, I ran the smoke suite
- [ ] If this touches an adapter, both sim and live drivers still share the state machine (`docs/simulation-policy.md`)
- [ ] If this adds a new research claim, it is cited in `docs/research/*`
- [ ] If this changes a safety invariant, I updated `packages/shared/src/safety.ts` tests and `docs/compliance/ai-risk-register.md`
- [ ] No placeholders, no TODOs, no "simplified version"
- [ ] No em-dashes in prose, no emojis
- [ ] I have not committed any secrets, PII, or customer data

## Research grounding

<!-- Link the paper, standard, or vendor doc this change is based on. VSBS is a research artefact; untraced claims are rejected. -->

## Screenshots / traces

<!-- For UI changes: before/after. For agent changes: a concrete SSE trace from `/v1/concierge/turn`. -->
