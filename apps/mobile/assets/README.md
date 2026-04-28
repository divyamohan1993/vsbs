# Mobile assets

Real assets must replace these placeholders before any EAS build:

- `icon.png` — 1024x1024 RGBA, App Store + Play Store icon.
- `adaptive-icon.png` — 1024x1024 RGBA, Android adaptive foreground.
- `splash.png` — 1242x2436 RGBA splash for iPhone Pro Max.
- `favicon.png` — 48x48 RGBA, web favicon.

The `app.json` references these by relative path. The TypeScript and Jest
tooling does not load them, so the typecheck + test pipeline is green
without them; only EAS Build / `expo export` requires them.
