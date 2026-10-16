/* =========================================================
   OURSPACE
   0006 後台帳號改用 ERP
   - 帳號密碼、角色、權限都在 ERP 資料庫（ourspace-erp-db）
   - 官網只記登入狀態與登入失敗次數
   - 舊的 staff_users / staff_sessions 不再使用（先保留，確認沒問題再刪）
   - 全部使用 IF NOT EXISTS，重複執行不會出錯
========================================================= */


/* 登入 session（user_id = ERP 的 user_id，例如 U0001；只存 token 的雜湊值） */
CREATE TABLE IF NOT EXISTS erp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id TEXT NOT NULL,

    token_hash TEXT NOT NULL UNIQUE,

    expires_at TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* 登入失敗次數（以 Email 為單位，連續失敗 5 次鎖 15 分鐘） */
CREATE TABLE IF NOT EXISTS login_attempts (
    account TEXT PRIMARY KEY,

    failed_count INTEGER NOT NULL DEFAULT 0,

    locked_until TEXT
);


CREATE INDEX IF NOT EXISTS idx_erp_sessions_user
ON erp_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_erp_sessions_expires
ON erp_sessions(expires_at);
