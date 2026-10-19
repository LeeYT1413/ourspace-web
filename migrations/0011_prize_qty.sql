/* =========================================================
   OURSPACE
   0011 比賽獎品加上數量（預設 1）
   ⚠ 只能執行一次（第二次會出現 duplicate column，可忽略）
========================================================= */

ALTER TABLE checkin_event_prizes ADD COLUMN qty INTEGER NOT NULL DEFAULT 1;
