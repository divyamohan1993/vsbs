# Contributing to VSBS

Thanks for thinking about contributing. VSBS is an opinionated, research-grade project, and the bar is high. This doc exists so you spend your effort in the places that land, not in places that bounce.

## Posture

VSBS is a **PhD-grade research artefact** positioned for **real OEM adoption**. That means:

1. **Every architectural claim traces to a source.** Peer-reviewed papers, published standards (ISO, NIST, FIPS, IETF), or vendor documentation. Untraced claims are rejected on review. See `docs/research/*` for how the existing decisions are cited.
2. **No placeholders, no TODOs, no "simplified version".** Every file that lands must be complete and correct. If something is truly deferred, it goes in `docs/roadmap-prod-deploy.md` with rationale, not in the code as a comment.
3. **Simulation parity.** For any adapter with a `_MODE` toggle, the sim and live drivers share the identical state machine. Promotion is a single env var flip. See `docs/simulation-policy.md`.
4. **Safety invariants are load-bearing.** Red-flag logic, post-commit safety checks, PHM states, command-grant lifetimes, and auto-pay caps are non-negotiable. Changes to any of these need explicit reviewer approval and matching test updates.

## What kinds of contributions we want

- **Research grounding**: add citations to an existing claim, or upgrade a citation from a blog post to a peer-reviewed source.
- **Adapters**: new OEM telematics, new payment PSP, new SMS gateway, new maps provider, new LLM provider — each one is a single file that conforms to the existing interface.
- **Test coverage**: unit tests for units that are under-covered; property-based tests; chaos tests for dependency failure modes.
- **Compliance artefacts**: jurisdiction-specific DPIA/FRIA addenda, new rows on the AI risk register, retention-schedule refinements.
- **Docs**: clarifications, typos, better diagrams, new research doc for a domain we have not yet covered.
- **Accessibility**: WCAG 2.2 AAA is the bar. Any AAA-enhancing fix is welcome.
- **Performance**: measured, grounded wins. Include before/after numbers.

## What we will usually reject

- Unsourced architectural claims or model-choice changes. ("use X instead of Y" without a citation)
- Style-only refactors with no behaviour or readability win.
- Emojis in prose or code. Em-dashes in prose. Long rhetorical docstrings.
- New dependencies without justification. Each dep must earn its place.
- Anything that silently weakens a safety invariant.
- Commits that bundle unrelated changes.

## Workflow

```bash
# 1. Fork + clone
git clone https://github.com/<you>/vsbs.git
cd vsbs

# 2. Install
pnpm install --ignore-scripts

# 3. Build libs once
pnpm run build:libs

# 4. Work on your change with the live baseline running
pnpm -r typecheck     # must stay green
pnpm -r test          # must stay green
pnpm run build        # must stay green

# 5. Run the live smoke suite
cd apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts &
bash /tmp/smoke.sh    # expect 25/25

# 6. Open a PR against main
```

Every PR runs CI (`pnpm -r typecheck`, `pnpm -r test`, `pnpm run build`, Trivy SBOM scan). PRs that do not pass CI will not be reviewed.

## Commit style

- One logical change per commit.
- Imperative subject line, 72 chars max.
- Body explains *why*, not *what* (the diff shows what).
- Reference the issue or discussion in the footer: `Refs: #42`.

## Code conventions

| Rule | Where enforced |
|---|---|
| Zod on every HTTP boundary and every tool argument | Code review + `apps/api/src/middleware/zv.ts` |
| Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | `tsconfig.base.json` |
| OKLCH colour tokens, 7:1 contrast, 44x44 hit targets | `apps/web/src/app/globals.css` + axe in CI |
| No direct `fetch` to external origins from the browser — everything via `/api/proxy/*` | CSP + review |
| Every sensor sample stamped `origin: "real" \| "sim"` | `packages/shared/src/sensors.ts` |
| Structured JSON logging with `rid`, PII-redacted paths | `apps/api/src/middleware/security.ts` |
| Unified error envelope `{error:{code,message,requestId}}` | `apps/api/src/middleware/security.ts` + `zv` wrapper |

## Reviewer expectations

- A reviewer will read the diff *and* the cited source.
- A reviewer will run your branch locally before approving non-trivial changes.
- A reviewer will flag any emoji, em-dash, or TODO and ask you to remove it.
- A reviewer will ask "what research supports this?" on any architectural change.

## License + attribution

By contributing you agree that your contribution is licensed under Apache License 2.0 (the project license) and that attribution under the `NOTICE` file remains with the original author. Your name will be added to the contributor list.

## Code of conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). Be kind, be precise, be technical.

## Where to ask questions

- **Research and methodology:** GitHub Discussions → Research.
- **How do I integrate / extend:** GitHub Discussions → Q&A.
- **Security:** private advisory per `SECURITY.md`. Never a public issue.
- **Partnership / OEM integration:** `contact@dmj.one`.
