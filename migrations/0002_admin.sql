/* =========================================================
   OURSPACE
   0002 後台帳號 / 登入 / 操作紀錄
========================================================= */


/* 後台人員（管理員 / 裁判），與官網會員 users 分開 */
CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT NOT NULL UNIQUE COLLATE NOCASE,

    display_name TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'referee',

    password_hash TEXT NOT NULL,

    password_salt TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'active',

    failed_count INTEGER NOT NULL DEFAULT 0,

    locked_until TEXT,

    last_login_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* 登入 session（只存 token 的雜湊值） */
CREATE TABLE IF NOT EXISTS staff_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    staff_id INTEGER NOT NULL,

    token_hash TEXT NOT NULL UNIQUE,

    expires_at TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
);


/* 操作紀錄：誰在什麼時候改了什麼 */
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    staff_id INTEGER,

    action TEXT NOT NULL,

    target_type TEXT,

    target_id INTEGER,

    detail TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff
ON staff_sessions(staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires
ON staff_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
ON audit_logs(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
ON audit_logs(created_at);
