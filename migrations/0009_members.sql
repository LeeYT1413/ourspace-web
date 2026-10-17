/* =========================================================
   OURSPACE
   0009 會員系統（LINE 登入）
   ⚠ 前面的 ALTER TABLE 只能執行一次；
     如果中途出錯，看錯誤訊息是哪一行，從那一行之後再貼一次即可。
========================================================= */

/* 會員資料（users 表原本就有：line_user_id、display_name、avatar_url、phone、status） */
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN line_name TEXT;
ALTER TABLE users ADD COLUMN primary_team_id INTEGER;
ALTER TABLE users ADD COLUMN joined_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

/* 報名資料：是哪位會員、由誰報名 */
ALTER TABLE checkin_entries ADD COLUMN user_id INTEGER;
ALTER TABLE checkin_entries ADD COLUMN registered_by INTEGER;


/* ---------- 以下可以重複執行 ---------- */

/* 會員登入狀態（只存 token 的雜湊值） */
CREATE TABLE IF NOT EXISTS member_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

/* 會員所屬戰隊（可以多個；加入要隊長核准） */
CREATE TABLE IF NOT EXISTS member_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    UNIQUE (user_id, team_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

/* 認領選手資料（後台審核） */
CREATE TABLE IF NOT EXISTS player_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by TEXT,
    reviewed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

/* 隊長提交的戰隊介紹 / 隊徽修改（後台審核） */
CREATE TABLE IF NOT EXISTS team_edit_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    description TEXT,
    logo_image_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by TEXT,
    reviewed_at TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_member_sessions_user ON member_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_member_teams_team ON member_teams(team_id, status);
CREATE INDEX IF NOT EXISTS idx_player_claims_status ON player_claims(status);
CREATE INDEX IF NOT EXISTS idx_team_edit_status ON team_edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_checkin_entries_user ON checkin_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_entries_by ON checkin_entries(registered_by);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
