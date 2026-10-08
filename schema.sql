-- Franklin Kos Trip! — database schema
-- Safe to run repeatedly: tables and seed rows are only created if missing,
-- so re-running it never touches items you've already added.

CREATE TABLE IF NOT EXISTS people (
  name TEXT PRIMARY KEY,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id    TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES people(name),
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id),
  name       TEXT NOT NULL,
  assignee   TEXT NOT NULL DEFAULT '',
  purchased  INTEGER NOT NULL DEFAULT 0,
  packed     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  sort       REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS items_by_case ON items(case_id, sort);

-- Who's going
INSERT OR IGNORE INTO people (name, sort) VALUES
  ('Mum', 1), ('Dad', 2), ('Harry', 3), ('Sofia', 4), ('Freddie', 5);

-- Everyone has a 20kg and a 10kg case, apart from Freddie (10kg only)
INSERT OR IGNORE INTO cases (id, owner, label, sort) VALUES
  ('mum-20',     'Mum',     '20kg case', 1),
  ('mum-10',     'Mum',     '10kg case', 2),
  ('dad-20',     'Dad',     '20kg case', 3),
  ('dad-10',     'Dad',     '10kg case', 4),
  ('harry-20',   'Harry',   '20kg case', 5),
  ('harry-10',   'Harry',   '10kg case', 6),
  ('sofia-20',   'Sofia',   '20kg case', 7),
  ('sofia-10',   'Sofia',   '10kg case', 8),
  ('freddie-10', 'Freddie', '10kg case', 9);
