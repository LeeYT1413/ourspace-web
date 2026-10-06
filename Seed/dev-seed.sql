/* =========================================================
   OURSPACE 本機測試資料
   只在本機使用：
   npx wrangler d1 execute ourspace-erp-db --local --file=seed/dev-seed.sql
   ⚠ 不要加 --remote，會清掉正式資料
========================================================= */

DELETE FROM player_ranking;
DELETE FROM league_matches;
DELETE FROM players;
DELETE FROM tournament_registrations;
DELETE FROM tournaments;
DELETE FROM teams;
DELETE FROM news;
DELETE FROM news_images;


/* 戰隊 */
INSERT INTO teams (id, team_code, team_name) VALUES
  (1, 'T-A', '戰隊 A'),
  (2, 'T-B', '戰隊 B'),
  (3, 'T-C', '戰隊 C'),
  (4, 'T-D', '戰隊 D'),
  (5, 'T-E', '戰隊 E'),
  (6, 'T-F', '戰隊 F');


/* 賽事（id 4 是草稿，官網不應該看到） */
INSERT INTO tournaments
  (id, tournament_code, title, tournament_type, description, location,
   start_at, end_at, registration_start_at, registration_end_at,
   max_players, max_teams, entry_fee, status)
VALUES
  (1, 'L2026-AUT', '2026 窩室秋季戰隊聯賽', 'team',
   '三人一隊，循環賽制，每兩週一個比賽日。' || char(10) || '前四名進入季後賽，冠軍隊伍可獲得窩室限定獎盃。',
   '窩室競技場', '2026-10-04 19:00', '2026-12-20 23:00',
   '2026-09-15 12:00', '2026-10-15 23:59', NULL, 8, 600, 'open'),

  (2, 'S-012', '窩室陀螺爭霸 #12', 'solo',
   '個人積分賽，成績計入本季上位排行榜。',
   '窩室競技場', '2026-10-25 14:00', '2026-10-25 18:00',
   '2026-10-01 12:00', '2026-10-24 21:00', 32, NULL, 200, 'open'),

  (3, 'L2027-WIN', '窩室冬季戰隊聯賽', 'team',
   '冬季聯賽，詳細賽制即將公布。',
   '窩室競技場', '2027-01-10 19:00', NULL,
   NULL, NULL, NULL, 8, 600, 'coming'),

  (4, 'TEST', '內部測試賽（草稿）', 'solo',
   '這筆不應該出現在官網。',
   NULL, '2026-11-01 14:00', NULL,
   NULL, NULL, 16, NULL, 0, 'draft');


/* 聯賽賽程：10/04 已完賽、10/18 未開賽 */
INSERT INTO league_matches
  (id, tournament_id, round_number, match_number, scheduled_at,
   team_a_id, team_b_id, score_a, score_b, status, winner_team_id, field_name, note)
VALUES
  (1, 1, 1, 1, '2026-10-04 20:00', 3, 4, 5, 4, 'finished', 3, 'A 場', NULL),
  (2, 1, 1, 2, '2026-10-04 21:30', 1, 2, 2, 3, 'finished', 2, 'A 場', NULL),
  (3, 1, 1, 3, '2026-10-04 23:00', 5, 6, 3, 1, 'finished', 5, 'B 場', NULL),
  (4, 1, 2, 1, '2026-10-18 19:30', 1, 3, NULL, NULL, 'scheduled', NULL, 'A 場', NULL),
  (5, 1, 2, 2, '2026-10-18 21:00', 2, 5, NULL, NULL, 'scheduled', NULL, 'A 場', NULL),
  (6, 1, 2, 3, '2026-10-18 22:30', 4, 6, NULL, NULL, 'scheduled', NULL, 'B 場', '直播場次');


/* 玩家 */
INSERT INTO players (id, player_name, nickname, team_id) VALUES
  (1, '玩家 A', '旋風', 1),
  (2, '玩家 B', NULL, 2),
  (3, '玩家 C', '鐵壁', 3),
  (4, '玩家 D', NULL, 4),
  (5, '玩家 E', NULL, 5),
  (6, '玩家 F', NULL, 6),
  (7, '玩家 G', NULL, 1),
  (8, '玩家 H', NULL, NULL),
  (9, '玩家 I', NULL, 3),
  (10, '玩家 J', NULL, NULL);


/* 排行榜 */
INSERT INTO player_ranking
  (player_id, season_name, rank_number, win_count, upper_count, points)
VALUES
  (1, '2026 Season 01', 1, 34, 28, 420),
  (2, '2026 Season 01', 2, 29, 21, 365),
  (3, '2026 Season 01', 3, 25, 18, 330),
  (4, '2026 Season 01', 4, 22, 15, 290),
  (5, '2026 Season 01', 5, 20, 13, 260),
  (6, '2026 Season 01', 6, 18, 11, 240),
  (7, '2026 Season 01', 7, 16, 10, 215),
  (8, '2026 Season 01', 8, 14, 9, 190),
  (9, '2026 Season 01', 9, 12, 8, 170),
  (10, '2026 Season 01', 10, 10, 7, 150);


/* 公告 */
INSERT INTO news (title, summary, content, category, status, published_at) VALUES
  ('窩室秋季戰隊聯賽開放報名',
   '全新賽季開始，報名到 10/15 截止。',
   '2026 秋季戰隊聯賽開放報名。' || char(10) || '每隊三人，報名費 NT$ 600，名額 8 隊，額滿為止。',
   'event', 'published', '2026-10-05 12:00'),
  ('本週陀螺爭霸排行榜更新',
   '旋風持續領先，第 2 名差距縮小到 7 場上位。',
   '本週排行榜已更新，詳細名次請到「陀螺爭霸」頁面查看。',
   'battle', 'published', '2026-10-03 18:00'),
  ('十月新品到貨',
   '新款陀螺與配件已上架，歡迎到店選購。',
   '十月新品已到貨，數量有限，歡迎到窩室現場選購。',
   'store', 'published', '2026-10-01 10:00');