# Franklin Kos Trip! — v1.1.1

Family packing planner at **https://holiday.page-one.events**, with Page One branding and a password.

- Each person has their own cases: Mum, Dad, Harry and Sofia have a 20kg and a 10kg case; Freddie has a 10kg case.
- Each item has a name, who's sorting it, **Purchased** and **Packed** tick boxes, and notes.
- Changes sync to everyone's phone or laptop within a few seconds.
- Use **Jobs for** to see just one person's jobs, and **Hide packed** to show only what's left.
- To add several items at once, paste a list (one item per line) into "Add an item…".

## How deploys work

Push to `main`, and Cloudflare builds and deploys it, usually within a minute. That's all there is to it after the one-time setup below.

## One-time setup

You need Node.js 18+ and the Cloudflare account that holds page-one.events.

1. **Clone and add the password file.** `.dev.vars` is git-ignored, so it never reaches GitHub.

   ```bash
   git clone https://github.com/Page-One-Events/page-one-kos.git
   cd page-one-kos
   echo 'PASSWORD="your-password-here"' > .dev.vars
   ```

2. **Bootstrap:**

   ```bash
   npm run setup
   ```

   This logs you in to Cloudflare. It then creates the `franklin-kos-trip` D1 database and commits and pushes its ID in `wrangler.jsonc`. Next it applies `schema.sql`, which creates the people and cases. It does the first deploy on `holiday.page-one.events` (Cloudflare adds the DNS record) and sets the password secret.

3. **Connect GitHub.** In the Cloudflare dashboard, go to **Workers & Pages → franklin-kos-trip → Settings → Builds → Connect**. Choose `Page-One-Events/page-one-kos`, branch `main`, and keep the default build settings (deploy command `npx wrangler deploy`).
   - If the repo isn't listed, give the Cloudflare GitHub app access to it under GitHub → Page-One-Events → Settings → GitHub Apps.

The password is a Cloudflare secret, so it stays in place across every deploy.

## Day to day

| Task | How |
|---|---|
| Release an update | Commit and push to `main` |
| Change the database schema | Edit `schema.sql`, push, then `npm run db:remote` |
| Change the password | `npx wrangler secret put PASSWORD` (logs every device out) |
| Run locally | `npm run dev`, then open http://localhost:8787 (password from `.dev.vars`) |

`schema.sql` only adds what's missing, so re-running it never touches existing items. Local data lives in `.wrangler/` and is separate from the live site.

## Customising

| What | Where |
|---|---|
| Real Page One logo | Replace `public/logo.svg` and keep the same filename. The current one is a placeholder mark. |
| Title | `public/index.html` and `public/login.html` |
| People and cases | `schema.sql`. Add rows, then run `npm run db:remote`. Removing people or cases needs a manual delete in D1. |
| Colours and fonts | Tokens at the top of `public/styles.css` |

Fonts: Gill Sans Nova is used if the device has it, then system Gill Sans (Mac and iPhone have it built in). Other devices fall back to Cabin from Google Fonts.

## How it works

- `src/worker.js` is a Cloudflare Worker. It handles the password gate (HttpOnly cookie, valid for 120 days), serves the JSON API (`/api/state`, `/api/items`) and serves the static files.
- `public/` holds the front end: plain HTML, CSS and JS with no build step. It polls every 4 seconds and doesn't overwrite a field while you're typing in it.
- Data lives in D1. Search engines are told not to index the site.

## Versioning

Semantic versioning. The current version is shown in the footer, and each release is tagged `vX.Y.Z`. See `CHANGELOG.md`.

To release, bump the version in `package.json`, `src/worker.js` (`VERSION`), `public/app.js` (`VERSION`), `public/index.html` (footer) and the changelog.
