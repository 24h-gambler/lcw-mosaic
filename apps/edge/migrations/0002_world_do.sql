-- docs/02-architecture.md §9.2 WorldDO Embedded SQLite Schema

create table if not exists meta (
  k text primary key,
  v text not null
);

create table if not exists chunks (
  cx integer not null,
  cy integer not null,
  cz integer not null,
  rev integer not null,
  data blob not null,
  primary key (cx, cy, cz)
);

create table if not exists objects (
  id text primary key,
  kind text not null,
  spec text not null,
  spec_version integer not null,
  owner text not null,
  state text not null,
  pos text not null,
  created_at integer not null
);

create table if not exists items (
  id text primary key,
  owner text not null,
  spec text not null,
  location text not null,
  durability integer not null,
  card_id text
);

create table if not exists ledger (
  id integer primary key autoincrement,
  player text not null,
  delta integer not null,
  reason text not null,
  ref text not null,
  at integer not null
);

create table if not exists journal (
  seq integer primary key autoincrement,
  at integer not null,
  actor text not null,
  op text not null,
  payload text not null,
  inverse text not null
);

create table if not exists snapshots (
  id text primary key,
  at integer not null,
  reason text not null,
  r2_key text not null,
  journal_seq integer not null
);
