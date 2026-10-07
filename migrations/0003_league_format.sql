/* =========================================================
   OURSPACE
   0003 戰隊聯賽：賽別（個人 / 雙人 / 三人）
   - 積分依「已結束」的比賽即時計算，不另外存表
   - 暫停狀態 paused 不需要改結構（status 欄位沒有限制值）
========================================================= */

/* solo = 個人賽、duo = 雙人賽、trio = 三人賽、team = 戰隊賽
   既有比賽會先預設為個人賽，請到後台「賽程」逐筆確認 */
ALTER TABLE league_matches
ADD COLUMN match_format TEXT NOT NULL DEFAULT 'solo';


CREATE INDEX IF NOT EXISTS idx_league_matches_format
ON league_matches(tournament_id, match_format);