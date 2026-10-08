# Franklin Kos Trip! — v1.0.0

Family packing planner at **https://holiday.page-one.events**, with Page One branding and a password.

- Each person has their own cases: Mum, Dad, Harry and Sofia have a 20kg and a 10kg case; Freddie has a 10kg case.
- Each item has a name, who's sorting it, **Purchased** and **Packed** tick boxes, and notes.
- Changes sync to everyone's phone or laptop within a few seconds.
- Use **Jobs for** to see just one person's jobs, and **Hide packed** to show only what's left.
- To add several items at once, paste a list (one item per line) into "Add an item…".

## Deploy (first time and every update)

You need Node.js 18+ and the Cloudflare account that holds page-one.events.

```bash
npm run setup
```

That single command will:

1. Install dependencies.
2. Log you in to Cloudflare (it opens a browser the first time).
3. Create the `franklin-kos-trip` D1 database and write its id into `wrangler.jsonc`.
4. Apply `schema.sql`, which creates the tables and the five people and nine cases.
5. Deploy the Worker on the custom domain `holiday.page-one.events`. Cloudflare adds the DNS record automatically.
6. Set the site password from `.dev.vars`.

It's safe to run again for each new release. The schema only adds what's missing, so it never touches existing items.

## Change the password

Edit `PASSWORD` in `.dev.vars`, then run `npm run setup` again. Alternatively, run `npx wrangler secret put PASSWORD` on its own.

Changing the password logs every device out.

## Run it locally

```bash
npm run dev       # http://localhost:8787 (password from .dev.vars)
```

Local data is kept in `.wrangler/` and is separate from the live site.

## Customising

| What | Where |
|---|---|
| Real Page One logo | Replace `public/logo.svg` and keep the same filename. The current one is a placeholder mark. |
| Title | `public/index.html` and `public/login.html` |
| People and cases | `schema.sql`. Add rows and re-run setup. Removing people or cases needs a manual delete in D1. |
| Colours and fonts | Tokens at the top of `public/styles.css` |

Fonts: Gill Sans Nova is used if the device has it, then system Gill Sans (Mac and iPhone have it built in). Other devices fall back to Cabin from Google Fonts.

## How it works

- `src/worker.js` is a Cloudflare Worker. It handles the password gate (HttpOnly cookie, valid for 120 days), serves the JSON API (`/api/state`, `/api/items`) and serves the static files.
- `public/` holds the front end: plain HTML, CSS and JS with no build step. It polls every 4 seconds and doesn't overwrite a field while you're typing in it.
- Data lives in D1. Search engines are told not to index the site.

## Versioning

The current version is shown in the footer. See `CHANGELOG.md`. When you release a new version, bump it in `package.json`, `src/worker.js` (`VERSION`), `public/app.js` (`VERSION`) and the changelog.
