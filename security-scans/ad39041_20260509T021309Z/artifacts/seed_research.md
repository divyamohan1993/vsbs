# Seed Research

No user-provided advisories, bug reports, CVEs, or seed findings were supplied. The scan therefore used repository-wide source review, runtime route inventory, Terraform/deployment review, and package-manager advisory output.

Sources used:

- Local repository at commit `ad39041132063a4dbcc773b9eb9c14de4e4775fb`.
- Runtime Hono app exercised with `bun run` through `app.fetch`.
- `pnpm audit` through `bun x pnpm@9.12.3`.
- Repository production/security docs: `README.md`, `docs/security/threat-model.md`, `docs/roadmap-prod-deploy.md`, `docs/gap-audit.md`, `SECURITY.md`, `SAFETY-NOTICE.md`.

External advisory seeds discovered from package audit:

- GHSA-wh4c-j3r5-mjhp: `@xmldom/xmldom <0.8.12`.
- GHSA-2v35-w6hq-6mfw: `@xmldom/xmldom <0.8.13`.
- GHSA-f6ww-3ggp-fr8h: `@xmldom/xmldom <0.8.13`.
- GHSA-x6wf-f3px-wcqx: `@xmldom/xmldom <0.8.13`.
- GHSA-j759-j44w-7fr8: `@xmldom/xmldom <0.8.13`.
- GHSA-q3j6-qgpj-74h6: `fast-uri <=3.1.0`.
- GHSA-v39h-62p7-jpjc: `fast-uri <=3.1.1`.
