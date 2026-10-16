-- 현장별 분리 + 이메일 계정
-- 기존 데이터(10/15 기록, 업체 목록)는 '기본 현장'으로 옮긴다.

-- 현장
create table if not exists sites (
  id bigint generated always as identity primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into sites (name) select '기본 현장' where not exists (select 1 from sites);

-- 계정 (Supabase Auth 사용자 1명 = 1행)
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  note text not null default '',               -- 가입 때 적은 소속/현장 메모
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- 현장 배정 (한 사람이 여러 현장 가능)
create table if not exists site_members (
  site_id bigint not null references sites(id) on delete cascade,
  user_id uuid not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (site_id, user_id)
);
create index if not exists site_members_user_idx on site_members (user_id);

-- 업체 목록: 현장별
alter table companies add column if not exists site_id bigint references sites(id) on delete cascade;
update companies set site_id = (select min(id) from sites) where site_id is null;
alter table companies alter column site_id set not null;
alter table companies drop constraint if exists companies_name_key;
alter table companies drop constraint if exists companies_site_name_key;
alter table companies add constraint companies_site_name_key unique (site_id, name);

-- 하루 기록: (현장, 날짜)가 하나
alter table dispatches drop constraint if exists dispatches_report_date_fkey;
alter table dispatches drop constraint if exists dispatches_report_date_seq_key;

alter table daily_reports add column if not exists site_id bigint references sites(id) on delete cascade;
update daily_reports set site_id = (select min(id) from sites) where site_id is null;
alter table daily_reports alter column site_id set not null;
alter table daily_reports drop constraint if exists daily_reports_pkey;
alter table daily_reports add primary key (site_id, report_date);

alter table dispatches add column if not exists site_id bigint;
update dispatches set site_id = (select min(id) from sites) where site_id is null;
alter table dispatches alter column site_id set not null;
alter table dispatches drop constraint if exists dispatches_report_fkey;
alter table dispatches add constraint dispatches_report_fkey
  foreign key (site_id, report_date) references daily_reports(site_id, report_date)
  on delete cascade on update cascade;
alter table dispatches drop constraint if exists dispatches_site_date_seq_key;
alter table dispatches add constraint dispatches_site_date_seq_key unique (site_id, report_date, seq);
create index if not exists dispatches_site_date_idx on dispatches (site_id, report_date);

-- 브라우저 직접 접근 차단 (서버만 읽고 씀)
alter table sites        enable row level security;
alter table profiles     enable row level security;
alter table site_members enable row level security;
