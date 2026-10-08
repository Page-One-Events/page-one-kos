// Franklin Kos Trip! — Worker
// Password gate + JSON API over D1 + serves the static front end from /public.

const VERSION = '1.1.1';
const COOKIE = 'fkt_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 120; // 120 days — log in once per device
const PUBLIC_ASSETS = new Set(['/login.html', '/styles.css', '/logo.svg', '/favicon.svg']);

const LIMITS = { name: 200, notes: 4000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- Public routes -------------------------------------------------
      if (path === '/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/login') return serveAsset(env, request, '/login.html');
      if (path === '/logout') {
        return new Response(null, {
          status: 303,
          headers: { Location: '/login', 'Set-Cookie': cookie('', 0) },
        });
      }
      if (path === '/health') return json({ ok: true, version: VERSION });
      if (PUBLIC_ASSETS.has(path)) return serveAsset(env, request, path);

      // ---- Everything else needs the password ----------------------------
      if (!(await isAuthed(request, env))) {
        if (path.startsWith('/api/')) return json({ error: 'Not logged in' }, 401);
        return redirect('/login');
      }

      if (path.startsWith('/api/')) return handleApi(request, env, path);
      if (path === '/' || path === '/index.html') return serveAsset(env, request, '/index.html');
      return serveAsset(env, request, path);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function handleLogin(request, env) {
  if (!env.PASSWORD) return new Response('PASSWORD secret is not set on this Worker.', { status: 500 });

  const form = await request.formData().catch(() => null);
  const given = String(form?.get('password') ?? '');

  const [a, b] = await Promise.all([digest(given), digest(env.PASSWORD)]);
  if (!timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 700)); // slow down guessing
    return redirect('/login?e=1');
  }

  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': cookie(await sessionToken(env), COOKIE_MAX_AGE) },
  });
}

async function isAuthed(request, env) {
  if (!env.PASSWORD) return false;
  const value = readCookie(request, COOKIE);
  if (!value) return false;
  return timingSafeEqual(value, await sessionToken(env));
}

// The session token is an HMAC of a fixed label keyed by the password,
// so changing the password logs every device out.
async function sessionToken(env) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('franklin-kos-trip/session/v1'));
  return hex(sig);
}

async function digest(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === '/api/state' && method === 'GET') {
    const [people, cases, items] = await env.DB.batch([
      env.DB.prepare('SELECT name FROM people ORDER BY sort'),
      env.DB.prepare('SELECT id, owner, label FROM cases ORDER BY sort'),
      env.DB.prepare('SELECT * FROM items ORDER BY sort, created_at'),
    ]);
    return json({
      version: VERSION,
      people: people.results.map((p) => p.name),
      cases: cases.results,
      items: items.results.map(shapeItem),
    });
  }

  if (path === '/api/items' && method === 'POST') {
    const body = await readJson(request);
    const caseId = String(body.case_id ?? '');
    const name = clean(body.name, LIMITS.name);
    if (!name) return json({ error: 'Item needs a name' }, 400);

    const theCase = await env.DB.prepare('SELECT id FROM cases WHERE id = ?').bind(caseId).first();
    if (!theCase) return json({ error: 'Unknown case' }, 400);

    const assignee = await validAssignee(env, body.assignee);
    if (assignee === null) return json({ error: 'Unknown person' }, 400);

    const now = Date.now();
    const id = crypto.randomUUID();
    const row = await env.DB.prepare(
      `INSERT INTO items (id, case_id, name, assignee, purchased, packed, notes, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM items WHERE case_id = ?), ?, ?)
       RETURNING *`,
    )
      .bind(id, caseId, name, assignee, clean(body.notes, LIMITS.notes), caseId, now, now)
      .first();
    return json(shapeItem(row), 201);
  }

  const match = path.match(/^\/api\/items\/([0-9a-f-]{36})$/);
  if (match) {
    const id = match[1];

    if (method === 'PATCH') {
      const body = await readJson(request);
      const sets = [];
      const values = [];

      if ('name' in body) {
        const name = clean(body.name, LIMITS.name);
        if (!name) return json({ error: 'Item needs a name' }, 400);
        sets.push('name = ?');
        values.push(name);
      }
      if ('assignee' in body) {
        const assignee = await validAssignee(env, body.assignee);
        if (assignee === null) return json({ error: 'Unknown person' }, 400);
        sets.push('assignee = ?');
        values.push(assignee);
      }
      for (const flag of ['purchased', 'packed']) {
        if (flag in body) {
          sets.push(`${flag} = ?`);
          values.push(body[flag] ? 1 : 0);
        }
      }
      if ('notes' in body) {
        sets.push('notes = ?');
        values.push(clean(body.notes, LIMITS.notes, true));
      }
      if (!sets.length) return json({ error: 'Nothing to change' }, 400);

      sets.push('updated_at = ?');
      values.push(Date.now());

      const row = await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
        .bind(...values, id)
        .first();
      if (!row) return json({ error: 'Item not found' }, 404);
      return json(shapeItem(row));
    }

    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}

async function validAssignee(env, value) {
  const name = String(value ?? '').trim();
  if (!name) return '';
  const person = await env.DB.prepare('SELECT name FROM people WHERE name = ?').bind(name).first();
  return person ? person.name : null;
}

function shapeItem(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    name: row.name,
    assignee: row.assignee,
    purchased: !!row.purchased,
    packed: !!row.packed,
    notes: row.notes,
    sort: row.sort,
    updated_at: row.updated_at,
  };
}

function clean(value, max, multiline = false) {
  let s = String(value ?? '');
  if (!multiline) s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

async function serveAsset(env, request, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: 'GET' }));
  if (res.status === 404) return new Response('Not found', { status: 404 });
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Always pick up new releases straight away
  out.headers.set('Cache-Control', 'no-cache');
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location } });
}
