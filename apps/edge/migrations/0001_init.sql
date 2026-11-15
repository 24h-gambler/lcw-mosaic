-- docs/02-architecture.md §9.1 D1 Main Relational Schema

create table if not exists families (
  id text primary key,
  created_at integer not null
);

create table if not exists guardians (
  id text primary key,
  family_id text not null,
  oauth_sub text unique,
  locale text not null default 'ko'
);

create table if not exists players (
  id text primary key,
  family_id text not null,
  kind text not null,
  nickname text not null,
  birth_year integer,
  l1 text not null default 'ko',
  target_lang text not null default 'en',
  level text not null default 'L1',
  level_locked integer not null default 0,
  tutor_student integer not null default 0
);

create table if not exists consents (
  player_id text not null,
  guardian_id text not null,
  scope text not null,
  granted_at integer,
  revoked_at integer,
  primary key (player_id, scope)
);

create table if not exists seats (
  id text primary key,
  payer_id text not null,
  player_id text not null,
  plan text not null,
  period text not null,
  starts_at integer not null,
  ends_at integer not null,
  status text not null
);

create table if not exists guest_passes (
  id text primary key,
  seat_id text not null,
  code text unique not null,
  used_by text,
  expires_at integer not null
);

create table if not exists friends (
  a text not null,
  b text not null,
  approved_by_guardian integer not null default 0,
  primary key (a, b)
);

create table if not exists worlds (
  id text primary key,
  owner_id text not null,
  name text not null,
  seed text not null,
  gen_version integer not null,
  mode text not null,
  lang text not null,
  visibility text not null default 'private',
  pvp integer not null default 0,
  max_players integer not null default 8,
  archived integer not null default 0,
  last_played integer
);

create table if not exists world_members (
  world_id text not null,
  player_id text not null,
  role text not null,
  primary key (world_id, player_id)
);

create table if not exists server_list (
  world_id text primary key,
  title text not null,
  tags text not null,
  audience text not null,
  online integer not null default 0,
  updated_at integer not null
);

create table if not exists world_reports (
  world_id text not null,
  reporter_id text not null,
  reason text not null,
  created_at integer not null,
  primary key (world_id, reporter_id)
);

create table if not exists utterances (
  id text primary key,
  player_id text not null,
  world_id text not null,
  session_id text not null,
  session_kind text not null,
  ctx text not null,
  mode text not null,
  interlocutor text not null,
  first_text text not null,
  target_text text not null,
  final_text text not null,
  words integer not null,
  l1_words integer not null,
  dur_ms integer not null,
  latency_ms integer not null,
  stars integer not null,
  hint_level text not null,
  attempts integer not null,
  score real not null,
  confidence real not null default 1.0,
  source text not null,
  audio_first text,
  audio_final text,
  created_at integer not null
);

create table if not exists memory_cards (
  id text primary key,
  player_id text not null,
  utterance_id text not null,
  item_id text not null,
  origin text not null,
  box integer not null,
  next_review_at integer not null,
  lapses integer not null,
  mastered_at integer
);

create table if not exists expressions (
  id text primary key,
  player_id text not null,
  lemma_key text not null,
  first_seen_at integer not null,
  born_in text not null,
  lesson_id text,
  reuse_solo integer not null default 0,
  last_used_at integer
);

create table if not exists lessons (
  id text primary key,
  player_id text not null,
  world_id text not null,
  started_at integer not null,
  ended_at integer,
  plan text not null,
  campaign_note text
);

create table if not exists lesson_minutes (
  lesson_id text not null,
  minute integer not null,
  student_ms integer not null,
  teacher_ms integer not null,
  exchanges integer not null,
  activity text not null,
  primary key (lesson_id, minute)
);

create table if not exists pins (
  id text primary key,
  lesson_id text not null,
  at_ms integer not null,
  kind text not null,
  note text not null,
  before_clip text,
  after_clip text
);

create table if not exists anchor_tasks (
  id text primary key,
  lesson_id text not null,
  prompt_id text not null,
  utterance_ids text not null,
  metrics text not null
);

create table if not exists metrics_weekly (
  player_id text not null,
  week text not null,
  m text not null,
  primary key (player_id, week)
);

create table if not exists reports (
  id text primary key,
  player_id text not null,
  kind text not null,
  ref_id text not null,
  facts text not null,
  body text not null,
  clips text not null,
  share_token text unique,
  opened_at integer,
  created_at integer not null
);

create table if not exists report_deliveries (
  report_id text primary key,
  player_id text not null,
  guardian_id text not null,
  kind text not null,
  share_token text not null,
  share_url text not null,
  status text not null,
  teacher_comment text,
  next_lesson_at text,
  sent_at integer not null,
  opened_at integer,
  reminder_sent_at integer
);

create table if not exists phrase_bank (
  id text primary key,
  lang text not null,
  ctx text not null,
  intent text not null,
  slots_key text not null,
  level text not null,
  offers text not null,
  tts text,
  status text not null
);

create table if not exists cache_entries (
  key_hash text primary key,
  lang text not null,
  offers text not null,
  status text not null,
  distinct_users integer not null default 0,
  created_at integer not null
);

create table if not exists quota_daily (
  day text not null,
  k text not null,
  used integer not null,
  primary key (day, k)
);
