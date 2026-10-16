-- 폐기물 반출 현황 DB
-- Supabase SQL Editor에 붙여넣고 Run (이미 적용했다면 다시 실행해도 안전)

-- 업체 목록 (엑셀 오른쪽 집계표 순서)
create table if not exists companies (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null default 0,
  separate boolean not null default false,   -- '대아'처럼 집계표 위에 따로 표시
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 하루 단위 기록
create table if not exists daily_reports (
  report_date date primary key,
  written_total int,                          -- 기록지에 적힌 '총댓수' (있으면)
  image_paths text[] not null default '{}',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 반출 1건 = 1행
create table if not exists dispatches (
  id bigint generated always as identity primary key,
  report_date date not null references daily_reports(report_date) on delete cascade on update cascade,
  seq int not null,                           -- 연번
  vehicle_no text not null default '',        -- 차량번호
  company text not null default '',           -- 업체
  out_time text not null default '',          -- 출차시간 'H:MM'
  unique (report_date, seq)
);
create index if not exists dispatches_vehicle_idx on dispatches (vehicle_no);
create index if not exists dispatches_company_idx on dispatches (company, report_date);

-- 브라우저 직접 접근 차단 (서버의 secret 키로만 읽고 씀)
alter table companies     enable row level security;
alter table daily_reports enable row level security;
alter table dispatches    enable row level security;

-- 원본 사진 보관 (비공개)
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

-- 기본 업체 목록 (설정 화면에서 수정 가능)
insert into companies (name, sort_order, separate) values
  ('대아', 0, true),
  ('방태', 1, false), ('한성', 2, false), ('금강', 3, false), ('광일', 4, false),
  ('한진', 5, false), ('한밭', 6, false), ('산양', 7, false), ('이도', 8, false),
  ('두성', 9, false), ('우광', 10, false), ('광일한', 11, false), ('문화', 12, false),
  ('강북', 13, false), ('대주', 14, false), ('동보', 15, false), ('정일', 16, false),
  ('홍명', 17, false), ('대흥', 18, false), ('지술', 19, false), ('삼흥', 20, false),
  ('경기', 21, false)
on conflict (name) do nothing;
