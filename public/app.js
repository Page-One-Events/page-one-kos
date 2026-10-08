// Franklin Kos Trip! — front end
// Vanilla JS, no build step. Polls the API so everyone's ticks stay in sync.
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const POLL_MS = 4000;
  const NOTES_DEBOUNCE_MS = 700;

  const state = { people: [], cases: [], items: [] };
  const pending = new Map();   // itemId -> { field: value } edits not yet confirmed by the server
  const deleting = new Set();  // itemIds being deleted
  const rows = new Map();      // itemId -> row refs
  const caseViews = new Map(); // caseId -> case refs
  let skeletonKey = '';
  let inflight = 0;
  let mutationSeq = 0;
  let lastSync = 0;

  const $ = (sel, root = document) => root.querySelector(sel);
  const filters = loadFilters();

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Logged out');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function mutate(fn) {
    inflight++;
    mutationSeq++;
    try {
      return await fn();
    } finally {
      inflight--;
    }
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  async function poll() {
    const seq = mutationSeq;
    try {
      const data = await api('GET', '/api/state');
      // Ignore a snapshot that may predate a local change
      if (seq !== mutationSeq || inflight > 0) return;
      applyServer(data);
      setSync('ok');
    } catch (err) {
      if (err.message !== 'Logged out') setSync('error');
    }
  }

  function applyServer(data) {
    state.people = data.people;
    state.cases = data.cases;
    state.items = data.items
      .filter((it) => !deleting.has(it.id))
      .map((it) => ({ ...it, ...(pending.get(it.id) || {}) }));
    render();
  }

  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await poll();
      schedulePoll();
    }, POLL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
  window.addEventListener('online', poll);

  function setSync(kind) {
    const el = $('#sync');
    el.dataset.state = kind;
    if (kind === 'ok') lastSync = Date.now();
    updateSyncText();
  }

  function updateSyncText() {
    const el = $('#sync');
    const text = $('.sync-text', el);
    const kind = el.dataset.state;
    if (kind === 'loading') text.textContent = 'Loading…';
    else if (kind === 'saving') text.textContent = 'Saving…';
    else if (kind === 'error') text.textContent = 'Offline — retrying';
    else text.textContent = 'Synced';
  }

  // ---------------------------------------------------------------------------
  // Item changes
  // ---------------------------------------------------------------------------

  function findItem(id) {
    return state.items.find((it) => it.id === id);
  }

  async function patchItem(id, fields) {
    const item = findItem(id);
    if (!item) return;
    Object.assign(item, fields);
    pending.set(id, { ...(pending.get(id) || {}), ...fields });
    render();
    setSync('saving');

    try {
      const saved = await mutate(() => api('PATCH', `/api/items/${id}`, fields));
      // Drop pending fields that the server now has (keep any typed since)
      const p = pending.get(id) || {};
      for (const [k, v] of Object.entries(fields)) if (p[k] === v) delete p[k];
      if (Object.keys(p).length) pending.set(id, p);
      else pending.delete(id);

      const current = findItem(id);
      if (current) Object.assign(current, saved, p);
      render();
      setSync('ok');
    } catch (err) {
      pending.delete(id);
      toast(`Couldn't save that change — ${err.message}`);
      setSync('error');
      poll();
    }
  }

  async function addItem(caseId, name, assignee) {
    setSync('saving');
    try {
      const item = await mutate(() => api('POST', '/api/items', { case_id: caseId, name, assignee }));
      if (!findItem(item.id)) state.items.push(item);
      render();
      setSync('ok');
      return item;
    } catch (err) {
      toast(`Couldn't add "${name}" — ${err.message}`);
      setSync('error');
      return null;
    }
  }

  async function deleteItem(id) {
    const item = findItem(id);
    if (!item) return;
    if (!confirm(`Delete "${item.name}"?`)) return;

    deleting.add(id);
    state.items = state.items.filter((it) => it.id !== id);
    render();
    setSync('saving');
    try {
      await mutate(() => api('DELETE', `/api/items/${id}`));
      setSync('ok');
    } catch (err) {
      toast(`Couldn't delete — ${err.message}`);
      setSync('error');
    } finally {
      deleting.delete(id);
      pending.delete(id);
      poll();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function fillPeopleSelect(select, includeBlank, blankLabel) {
    const current = select.value;
    select.textContent = '';
    if (includeBlank) select.append(new Option(blankLabel, ''));
    for (const p of state.people) select.append(new Option(p, p));
    select.value = current;
  }

  function buildSkeleton() {
    const key = JSON.stringify([state.people, state.cases]);
    if (key === skeletonKey) return;
    skeletonKey = key;

    const root = $('#people');
    root.textContent = '';
    caseViews.clear();
    rows.clear();

    // Nav chips + filter options
    const nav = $('#people-nav');
    nav.textContent = '';
    for (const person of state.people) {
      if (!state.cases.some((c) => c.owner === person)) continue;
      const a = document.createElement('a');
      a.className = 'chip';
      a.href = `#${slug(person)}`;
      a.textContent = person;
      nav.append(a);
    }
    const filterSel = $('#filter-person');
    fillPeopleSelect(filterSel, true, 'Everyone');
    filterSel.value = state.people.includes(filters.person) ? filters.person : '';

    // People sections and their cases
    for (const person of state.people) {
      const cases = state.cases.filter((c) => c.owner === person);
      if (!cases.length) continue;

      const section = $('#tpl-person').content.firstElementChild.cloneNode(true);
      section.id = slug(person);
      $('.person-name', section).textContent = person;
      const casesEl = $('.cases', section);
      if (cases.length === 1) casesEl.classList.add('single');

      for (const c of cases) {
        const el = $('#tpl-case').content.firstElementChild.cloneNode(true);
        el.dataset.case = c.id;
        $('.case-owner', el).textContent = `${c.owner}'s`;
        $('.case-label', el).textContent = c.label;

        const addSel = $('.add-assignee', el);
        fillPeopleSelect(addSel, true, 'No one');
        addSel.value = c.owner;

        const form = $('.add', el);
        const input = $('.add-name', el);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          // Paste a list (one per line) to add several at once
          const names = input.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (!names.length) return input.focus();
          input.value = '';
          for (const name of names) await addItem(c.id, name, addSel.value);
          input.focus();
        });
        input.addEventListener('paste', (e) => {
          const text = e.clipboardData?.getData('text') || '';
          if (!text.includes('\n')) return;
          e.preventDefault();
          const names = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          (async () => {
            for (const name of names) await addItem(c.id, name, addSel.value);
          })();
        });

        casesEl.append(el);
        caseViews.set(c.id, {
          el,
          list: $('.items', el),
          empty: $('.empty', el),
          statPurchased: $('.stat-purchased', el),
          statPacked: $('.stat-packed', el),
          bar: $('.bar i', el),
        });
      }
      root.append(section);
    }
  }

  function buildRow(item) {
    const li = $('#tpl-item').content.firstElementChild.cloneNode(true);
    const r = {
      el: li,
      name: $('.item-name', li),
      assignee: $('.item-assignee', li),
      purchased: $('.tick-purchased input', li),
      packed: $('.tick-packed input', li),
      notes: $('.item-notes', li),
      del: $('.item-del', li),
      notesTimer: null,
    };
    li.dataset.id = item.id;
    fillPeopleSelect(r.assignee, true, 'No one');

    const id = item.id;
    const commitName = () => {
      const value = r.name.value.replace(/\s+/g, ' ').trim();
      const current = findItem(id);
      if (!current) return;
      if (!value) {
        r.name.value = current.name;
        return;
      }
      if (value !== current.name) patchItem(id, { name: value });
    };
    r.name.addEventListener('change', commitName);
    r.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') r.name.blur();
      if (e.key === 'Escape') {
        r.name.value = findItem(id)?.name ?? r.name.value;
        r.name.blur();
      }
    });

    r.assignee.addEventListener('change', () => patchItem(id, { assignee: r.assignee.value }));
    r.purchased.addEventListener('change', () => patchItem(id, { purchased: r.purchased.checked }));
    r.packed.addEventListener('change', () => patchItem(id, { packed: r.packed.checked }));

    const flushNotes = () => {
      clearTimeout(r.notesTimer);
      r.notesTimer = null;
      const current = findItem(id);
      if (current && r.notes.value !== current.notes) patchItem(id, { notes: r.notes.value });
    };
    r.notes.addEventListener('input', () => {
      autoGrow(r.notes);
      // Hold the value locally so a sync doesn't overwrite what's being typed
      pending.set(id, { ...(pending.get(id) || {}), notes: r.notes.value });
      clearTimeout(r.notesTimer);
      r.notesTimer = setTimeout(flushNotes, NOTES_DEBOUNCE_MS);
    });
    r.notes.addEventListener('blur', () => {
      if (r.notesTimer) flushNotes();
    });

    r.del.addEventListener('click', () => deleteItem(id));
    rows.set(id, r);
    return r;
  }

  function updateRow(r, item) {
    const active = document.activeElement;
    if (active !== r.name && r.name.value !== item.name) r.name.value = item.name;
    if (active !== r.assignee && r.assignee.value !== item.assignee) r.assignee.value = item.assignee;
    r.purchased.checked = item.purchased;
    r.packed.checked = item.packed;
    if (active !== r.notes && r.notes.value !== item.notes) {
      r.notes.value = item.notes;
      autoGrow(r.notes);
    }
    r.el.classList.toggle('is-packed', item.packed);
    r.el.classList.toggle('is-purchased', item.purchased);
    r.el.classList.toggle('is-unassigned', !item.assignee);

    const hiddenByPerson = filters.person && item.assignee !== filters.person;
    const hiddenByPacked = filters.hidePacked && item.packed;
    r.el.hidden = !!(hiddenByPerson || hiddenByPacked);
  }

  function render() {
    buildSkeleton();

    const seen = new Set();
    let totalPurchased = 0;
    let totalPacked = 0;
    let total = 0;

    for (const [caseId, view] of caseViews) {
      const items = state.items
        .filter((it) => it.case_id === caseId)
        .sort((a, b) => a.sort - b.sort);

      let visible = 0;
      items.forEach((item, i) => {
        seen.add(item.id);
        let r = rows.get(item.id);
        if (!r) r = buildRow(item);
        // Only move rows that are out of place (moving a focused row would blur it)
        if (view.list.children[i] !== r.el) view.list.insertBefore(r.el, view.list.children[i] || null);
        updateRow(r, item);
        if (!r.el.hidden) visible++;
      });

      const purchased = items.filter((it) => it.purchased).length;
      const packed = items.filter((it) => it.packed).length;
      totalPurchased += purchased;
      totalPacked += packed;
      total += items.length;

      view.statPurchased.textContent = `${purchased}/${items.length} purchased`;
      view.statPacked.textContent = `${packed}/${items.length} packed`;
      view.bar.style.width = items.length ? `${(packed / items.length) * 100}%` : '0%';
      view.el.classList.toggle('is-done', items.length > 0 && packed === items.length);

      if (!items.length) view.empty.textContent = 'Nothing in this case yet.';
      else if (!visible && filters.person) view.empty.textContent = `Nothing for ${filters.person} in here.`;
      else if (!visible) view.empty.textContent = 'All packed.';
      else view.empty.textContent = '';
      view.empty.hidden = !view.empty.textContent;
    }

    for (const [id, r] of rows) {
      if (!seen.has(id)) {
        r.el.remove();
        rows.delete(id);
      }
    }

    $('#overall-purchased').textContent = `${totalPurchased}/${total}`;
    $('#overall-packed').textContent = `${totalPacked}/${total}`;
    $('#overall-bar').style.width = total ? `${(totalPacked / total) * 100}%` : '0%';
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  // ---------------------------------------------------------------------------
  // Filters (remembered per device)
  // ---------------------------------------------------------------------------

  function loadFilters() {
    try {
      return { person: '', hidePacked: false, ...JSON.parse(localStorage.getItem('fkt-filters') || '{}') };
    } catch {
      return { person: '', hidePacked: false };
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem('fkt-filters', JSON.stringify(filters));
    } catch {
      /* storage unavailable — filters just won't be remembered */
    }
  }

  $('#filter-person').addEventListener('change', (e) => {
    filters.person = e.target.value;
    saveFilters();
    render();
  });
  const hidePacked = $('#filter-hide-packed');
  hidePacked.checked = !!filters.hidePacked;
  hidePacked.addEventListener('change', () => {
    filters.hidePacked = hidePacked.checked;
    saveFilters();
    render();
  });

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4500);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  $('#version').textContent = `v${VERSION}`;
  window.addEventListener('resize', () => rows.forEach((r) => autoGrow(r.notes)));
  poll().then(() => {
    // Re-apply the hash jump once sections exist
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    schedulePoll();
  });
})();
