# Changelog

All notable changes to Franklin Kos Trip! are listed here.
Versions follow semantic versioning (MAJOR.MINOR.PATCH). The current version is shown in the site footer.

## 1.1.1 — 2026-10-08

- Removed a duplicate database binding that `wrangler d1 create` added to `wrangler.jsonc` during setup.
- `npm run setup` now strips that extra binding automatically if it appears.

## 1.1.0 — 2026-10-08

- Code now lives in GitHub (Page-One-Events/page-one-kos) and deploys through Cloudflare's GitHub integration: every push to `main` goes live automatically.
- `npm run setup` is now a one-time bootstrap. It creates the database, commits its id to the repo, does the first deploy and sets the password.
- Added `npm run db:remote` to apply schema changes to the live database.

## 1.0.0 — 2026-10-08

First release.

- Password-protected site at holiday.page-one.events (one shared family password, remembered per device for 120 days).
- Page One branding: logo mark, Gill Sans Nova type, black / mid-grey / yellow palette, folded-corner case cards; light and dark mode.
- Big "Franklin Kos Trip!" title with overall purchased / packed progress.
- Cases: 20kg and 10kg for Mum, Dad, Harry and Sofia; 10kg for Freddie.
- Items per case with name, assigned person, Purchased tick, Packed tick and notes. Names and notes are editable in place.
- Add items one at a time, or paste a list (one per line) to add several at once.
- Live sync every 4 seconds across everyone's devices, with a sync status indicator.
- Filters: "Jobs for" a person and "Hide packed", remembered per device.
- Quick-jump chips for each person.
