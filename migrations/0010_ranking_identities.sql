/* =========================================================
   OURSPACE
   0010 排行榜（上位率）、免報名費、會員的戰隊暱稱
   ⚠ 第一行 ALTER TABLE 只能執行一次；
     如果中途出錯，看錯誤訊息是哪一行，從那一行之後再貼一次即可。
========================================================= */

/* 報到時標記「免」報名費（前台不顯示） */
ALTER TABLE checkin_entries ADD COLUMN fee_waived INTEGER NOT NULL DEFAULT 0;


/* ---------- 以下可以重複執行 ---------- */

/* 排行榜：上位次數、上位率先算好存起來（有變動時重算） */
CREATE TABLE IF NOT EXISTS rank_stats (
    rank_key TEXT PRIMARY KEY,          -- U + 會員編號，或 P + 選手資料編號（還沒連到會員的）
    user_id INTEGER,
    player_id INTEGER,
    display_name TEXT NOT NULL,
    team_name TEXT,
    avatar_url TEXT,
    upper_count INTEGER NOT NULL DEFAULT 0,
    first_count INTEGER NOT NULL DEFAULT 0,
    upper_rate REAL NOT NULL DEFAULT 0,
    last_date TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rank_stats_order ON rank_stats(upper_count DESC, upper_rate DESC, last_date DESC);
CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id);

/* 已經加入戰隊的會員，補上「這個戰隊的暱稱」（選手資料） */
INSERT INTO players (user_id, player_name, nickname, team_id)
SELECT u.id, u.nickname, u.nickname, mt.team_id
FROM member_teams mt
INNER JOIN users u ON u.id = mt.user_id
WHERE mt.status = 'active'
  AND u.nickname IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM players p WHERE p.user_id = u.id AND p.team_id = mt.team_id);

/* 下次有人打開排行榜時重新計算 */
INSERT INTO site_settings (setting_key, setting_value) VALUES ('rank_dirty', '1')
ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1';
