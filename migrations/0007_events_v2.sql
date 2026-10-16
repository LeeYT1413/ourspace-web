/* =========================================================
   OURSPACE
   0007 場次管理 v2：場次類型、報名設定、預設獎品、多門檻抽獎、
        賽後紀錄（費用／上位者）、封存、網站設定、圖片
   ⚠ 前面的 ALTER TABLE 只能執行一次；
     如果中途出錯，看錯誤訊息是哪一行，從那一行之後再貼一次即可。
========================================================= */

ALTER TABLE checkin_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE checkin_events ADD COLUMN fee INTEGER;
ALTER TABLE checkin_events ADD COLUMN capacity INTEGER;
ALTER TABLE checkin_events ADD COLUMN reg_deadline TEXT;
ALTER TABLE checkin_events ADD COLUMN poster_image_id INTEGER;
ALTER TABLE checkin_events ADD COLUMN bonus_text TEXT;
ALTER TABLE checkin_events ADD COLUMN rules_text TEXT;
ALTER TABLE checkin_events ADD COLUMN special_text TEXT;
ALTER TABLE checkin_events ADD COLUMN notes_text TEXT;
ALTER TABLE checkin_events ADD COLUMN ended_at TEXT;
ALTER TABLE checkin_events ADD COLUMN archived_at TEXT;
ALTER TABLE checkin_events ADD COLUMN archived_by TEXT;
ALTER TABLE checkin_events ADD COLUMN settle_fees TEXT;
ALTER TABLE checkin_events ADD COLUMN settle_note TEXT;
ALTER TABLE checkin_events ADD COLUMN settled_at TEXT;
ALTER TABLE checkin_lottery_wins ADD COLUMN tier_id INTEGER;


/* ---------- 以下都可以重複執行 ---------- */

/* 場次的預設比賽獎品（冠軍、亞軍…，數量不限） */
CREATE TABLE IF NOT EXISTS checkin_event_prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    rank_label TEXT NOT NULL,
    prize TEXT,
    FOREIGN KEY (event_id) REFERENCES checkin_events(id)
);

/* 抽獎門檻：報到滿 N 人開放抽某個獎 × 名額 */
CREATE TABLE IF NOT EXISTS checkin_lottery_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    min_players INTEGER NOT NULL DEFAULT 0,
    prize TEXT,
    qty INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (event_id) REFERENCES checkin_events(id)
);

/* 賽後紀錄：上位者 */
CREATE TABLE IF NOT EXISTS checkin_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    rank_label TEXT NOT NULL,
    entry_id INTEGER,
    prize TEXT,
    /* 封存時寫進「選手上位紀錄」的那一筆，解除封存時用來撤回 */
    placement_id INTEGER,
    FOREIGN KEY (event_id) REFERENCES checkin_events(id),
    FOREIGN KEY (entry_id) REFERENCES checkin_entries(id)
);

/* 網站設定（營業時間、地址、社群、關於我們、常用內容） */
CREATE TABLE IF NOT EXISTS site_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
);

/* 後台上傳的圖片（海報、店面照片），已在手機上壓縮過 */
CREATE TABLE IF NOT EXISTS site_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkin_event_prizes_event ON checkin_event_prizes(event_id);
CREATE INDEX IF NOT EXISTS idx_checkin_lottery_tiers_event ON checkin_lottery_tiers(event_id);
CREATE INDEX IF NOT EXISTS idx_checkin_results_event ON checkin_results(event_id);
CREATE INDEX IF NOT EXISTS idx_checkin_lottery_wins_tier ON checkin_lottery_wins(tier_id);

/* 舊的單一抽獎門檻，轉成一個門檻（沒有獎品名稱） */
INSERT INTO checkin_lottery_tiers (event_id, sort, min_players, prize, qty)
SELECT e.id, 0, e.lottery_min_players, NULL, 99
FROM checkin_events e
WHERE e.lottery_min_players > 0
  AND NOT EXISTS (SELECT 1 FROM checkin_lottery_tiers t WHERE t.event_id = e.id);

/* 預設網站設定 */
INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES
('store', '{"hours":[{"day":"每天","time":"18:00 – 24:00"},{"day":"深夜場與公休日","time":"請看社群"}],"address":"高雄市三民區陽明路11號","map_url":""}'),
('socials', '{"line_official":"","line_group":"","instagram":""}'),
('about', '{"text":"","image_id":null}'),
('presets', '{"bonus":["一輪遊的鬥士可享 [回饋內容]"],"rules":["瑞士輪 [N] 輪，前 [N] 強進入單淘汰","3 戰 2 勝制"],"special":[],"notes":["請提前 30 分鐘報到","報名費現場繳交"]}');
