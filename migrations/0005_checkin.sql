/* =========================================================
   OURSPACE
   0005 報到系統 / 抽獎（由獨立的報到 Worker 整合進官網）
   - 每個「場次」各自一份名單，不再用封存＋清空
   - 全部使用 IF NOT EXISTS，重複執行不會出錯
========================================================= */


/* 場次：一天可以有多個場次 */
CREATE TABLE IF NOT EXISTS checkin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    event_date TEXT NOT NULL,

    title TEXT NOT NULL,

    start_time TEXT,

    /* 報到人數滿幾人才抽獎；0 = 不限制（之後由 ERP 設定） */
    lottery_min_players INTEGER NOT NULL DEFAULT 0,

    /* 1 = 官網「名單」頁看得到 */
    is_public INTEGER NOT NULL DEFAULT 1,

    note TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* 報名 / 報到名單 */
CREATE TABLE IF NOT EXISTS checkin_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    event_id INTEGER NOT NULL,

    nickname TEXT NOT NULL,

    /* 對應官網選手（可空白） */
    player_id INTEGER,

    checked_in INTEGER NOT NULL DEFAULT 0,

    checkin_number INTEGER,

    is_judge INTEGER NOT NULL DEFAULT 0,

    /* 賽程：場次 / 狀態（0 等候、1 準備、2 上場）/ 場地 */
    match_schedule INTEGER NOT NULL DEFAULT 0,

    match_status INTEGER NOT NULL DEFAULT 0,

    match_field INTEGER NOT NULL DEFAULT 0,

    checked_in_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (event_id) REFERENCES checkin_events(id),

    FOREIGN KEY (player_id) REFERENCES players(id)
);


/* 抽獎紀錄：同一場次每人最多中一次 */
CREATE TABLE IF NOT EXISTS checkin_lottery_wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    event_id INTEGER NOT NULL,

    entry_id INTEGER NOT NULL,

    prize TEXT,

    drawn_by INTEGER,

    drawn_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (event_id, entry_id),

    FOREIGN KEY (event_id) REFERENCES checkin_events(id),

    FOREIGN KEY (entry_id) REFERENCES checkin_entries(id)
);


CREATE INDEX IF NOT EXISTS idx_checkin_events_date
ON checkin_events(event_date);

/* 同一場次名稱不重複（不分大小寫） */
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_entries_name
ON checkin_entries(event_id, nickname COLLATE NOCASE);

/* 同一場次參賽號碼不重複 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_entries_number
ON checkin_entries(event_id, checkin_number)
WHERE checkin_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkin_lottery_event
ON checkin_lottery_wins(event_id);
