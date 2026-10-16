/* =========================================================
   OURSPACE
   0008 官網前台 v2：非會員線上報名、舊賽事搬進場次管理
   ⚠ 前面的 ALTER TABLE 只能執行一次；最後的「搬舊賽事」也只執行一次。
     如果中途出錯，看錯誤訊息是哪一行，從那一行之後再貼一次即可。
========================================================= */

/* 報名資料：聯絡電話（選填，只有後台看得到）、報名來源 */
ALTER TABLE checkin_entries ADD COLUMN contact_phone TEXT;
ALTER TABLE checkin_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE checkin_entries ADD COLUMN registered_at TEXT;

/* 舊賽事的封面是網址，不是上傳的圖片 */
ALTER TABLE checkin_events ADD COLUMN poster_link TEXT;
ALTER TABLE checkin_events ADD COLUMN tournament_id INTEGER;


/* ---------- 以下可以重複執行 ---------- */

/* 線上報名次數限制（同一個網路連線短時間內） */
CREATE TABLE IF NOT EXISTS signup_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip ON signup_attempts(ip_hash, created_at);


/* ---------- 舊的「賽事報名」搬進場次管理（只執行一次） ----------
   戰隊聯賽用到的賽事不搬（聯賽的賽程與積分還掛在原本的賽事上）。
   已經搬過的（tournament_id 有值）不會重複搬。
   已經過去的賽事直接標成「已封存」，不會出現在待封存。 */
INSERT INTO checkin_events
  (event_type, event_date, title, start_time, is_public, note, fee, capacity, reg_deadline,
   poster_link, rules_text, tournament_id, ended_at, archived_at, archived_by)
SELECT
  'big',
  date(t.start_at),
  t.title,
  CASE WHEN length(t.start_at) >= 16 THEN substr(t.start_at, 12, 5) ELSE NULL END,
  CASE WHEN t.status IN ('open', 'ongoing', 'closed', 'finished') THEN 1 ELSE 0 END,
  t.location,
  t.entry_fee,
  COALESCE(t.max_players, t.max_teams),
  CASE WHEN length(t.registration_end_at) >= 16 THEN substr(replace(t.registration_end_at, ' ', 'T'), 1, 16) ELSE NULL END,
  t.cover_image_url,
  t.description,
  t.id,
  CASE WHEN date(t.start_at) < date('now', '+8 hours') THEN datetime('now', '+8 hours') ELSE NULL END,
  CASE WHEN date(t.start_at) < date('now', '+8 hours') THEN substr(datetime('now', '+8 hours'), 1, 16) ELSE NULL END,
  CASE WHEN date(t.start_at) < date('now', '+8 hours') THEN 'migration' ELSE NULL END
FROM tournaments t
WHERE t.start_at IS NOT NULL
  AND t.status != 'draft'
  AND NOT EXISTS (SELECT 1 FROM league_matches lm WHERE lm.tournament_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM checkin_events e WHERE e.tournament_id = t.id);
