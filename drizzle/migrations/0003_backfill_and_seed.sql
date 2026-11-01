-- 1. Give every existing event its own series (one series per event).
--    One-off backfill: `match_key` should be
--    normalizeForMatch(stripEditionMarkers(title)), which cannot run in SQL,
--    so the event's `normalized_title` is used for now. The series feature
--    recomputes `match_key` on its first write to a series.
--    `description` temporarily holds the event id to link the rows and is
--    cleared afterwards. Ids are random UUID v4 strings.
INSERT INTO `event_series` (`id`, `title`, `match_key`, `description`, `created_by_id`, `created_at`)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `title`,
  `normalized_title`,
  `id`,
  `created_by_id`,
  `created_at`
FROM `events`
WHERE `series_id` IS NULL;

UPDATE `events`
SET `series_id` = (SELECT `s`.`id` FROM `event_series` `s` WHERE `s`.`description` = `events`.`id`)
WHERE `series_id` IS NULL;

UPDATE `event_series`
SET `description` = NULL
WHERE `description` IN (SELECT `id` FROM `events`);

-- 2. Start month (1-12). One-off backfill that assumes Asia/Tokyo (+9h, no
--    DST). Application code computes this with zonedParts() on write, so
--    SQL never does time-zone math after this migration.
UPDATE `events`
SET `start_month` = cast(strftime('%m', `start_at` / 1000, 'unixepoch', '+9 hours') as integer)
WHERE `start_at` IS NOT NULL;

-- 3. Recommended tags (docs/feature-plan.md §5.2). `slug` = normalizeTagName(name).
INSERT INTO `tags` (`name`, `slug`, `facet`) VALUES
  ('初心者歓迎', '初心者歓迎', 'audience'),
  ('中学生OK', '中学生ok', 'audience'),
  ('高校生向け', '高校生向け', 'audience'),
  ('文系歓迎', '文系歓迎', 'audience'),
  ('個人で参加', '個人で参加', 'participation'),
  ('チームで参加', 'チームで参加', 'participation'),
  ('学校単位で参加', '学校単位で参加', 'participation'),
  ('メンターあり', 'メンターあり', 'participation'),
  ('1日完結', '1日完結', 'schedule'),
  ('複数日', '複数日', 'schedule'),
  ('合宿・宿泊あり', '合宿・宿泊あり', 'schedule'),
  ('オンライン完結', 'オンライン完結', 'schedule'),
  ('土日開催', '土日開催', 'schedule'),
  ('春休み', '春休み', 'schedule'),
  ('夏休み', '夏休み', 'schedule'),
  ('冬休み', '冬休み', 'schedule'),
  ('表彰あり', '表彰あり', 'outcome'),
  ('賞金・副賞あり', '賞金・副賞あり', 'outcome'),
  ('交通費補助あり', '交通費補助あり', 'outcome'),
  ('企業・大学と交流', '企業・大学と交流', 'outcome'),
  ('作品が残る', '作品が残る', 'outcome'),
  ('全国大会', '全国大会', 'outcome'),
  ('予選あり', '予選あり', 'outcome');
