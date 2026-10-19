/* =========================================================
   OURSPACE
   排行榜（陀螺爭霸）

   規則
   - 參賽人數 30 人以上的比賽，名次才算上位
   - 每筆上位的比率 = 參賽人數 ÷ 名次（32 人拿冠軍 = 32；32 人拿亞軍 = 16）
   - 上位率 = 所有比率加總後取平均，只記整數（顯示成 %）
   - 排序：上位次數多 → 上位率高 → 最近拿到上位的
   - 同一位會員連了多筆選手資料（不同戰隊的暱稱）會合併計算

   結果存在 rank_stats，有變動時（封存、認領、連結選手資料、後台修改上位紀錄）
   標記 rank_dirty，下次有人看排行榜時才重算一次。
========================================================= */

export var RANK_MIN_PLAYERS = 30;

/* 計算方式改了就換版本號，上線後第一次打開排行榜會自動重算 */
var RANK_VERSION = "clean-v2";


export async function markRankingDirty(env) {

  try {
    await env.DB.prepare(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES ('rank_dirty', '1') " +
      "ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1'"
    ).run();
  } catch (error) {
    console.error("mark ranking dirty failed:", error);
  }
}


export async function rebuildRanking(env) {

  await env.DB.batch([
    env.DB.prepare("DELETE FROM rank_stats"),
    env.DB.prepare(
      "INSERT INTO rank_stats (rank_key, user_id, player_id, display_name, team_name, avatar_url, " +
      "upper_count, first_count, upper_rate, last_date) " +
      "SELECT " +
      "CASE WHEN u.id IS NOT NULL THEN 'U' || u.id ELSE 'P' || p.id END AS rank_key, " +
      "u.id, CASE WHEN u.id IS NULL THEN p.id ELSE NULL END, " +
      "COALESCE(MAX(CASE WHEN u.id IS NOT NULL THEN COALESCE((SELECT x.nickname FROM players x " +
      "  WHERE x.user_id = u.id AND x.team_id = u.primary_team_id AND x.nickname IS NOT NULL LIMIT 1), u.nickname) END), " +
      "  MAX(COALESCE(NULLIF(p.nickname, ''), p.player_name))), " +
      "COALESCE(MAX(CASE WHEN u.id IS NOT NULL THEN ut.team_name END), MAX(t.team_name)), " +
      "COALESCE(MAX(u.avatar_url), MAX(p.avatar_url)), " +
      "COUNT(pp.id), " +
      "SUM(CASE WHEN pp.placement = 1 THEN 1 ELSE 0 END), " +
      "ROUND(AVG(CAST(pp.participant_count AS REAL) / pp.placement)), " +
      "MAX(pp.event_date) " +
      "FROM player_placements pp " +
      "INNER JOIN players p ON p.id = pp.player_id " +
      "LEFT JOIN users u ON u.id = p.user_id AND u.status = 'active' " +
      "LEFT JOIN teams t ON t.id = p.team_id " +
      "LEFT JOIN teams ut ON ut.id = u.primary_team_id " +
      "WHERE p.status = 'active' AND pp.placement > 0 AND pp.participant_count >= ? " +
      "GROUP BY rank_key"
    ).bind(RANK_MIN_PLAYERS),
    env.DB.prepare(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES ('rank_dirty', ?) " +
      "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(RANK_VERSION)
  ]);
}


export async function ensureRanking(env) {

  var flag = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'rank_dirty'").first();

  if (!flag || flag.setting_value !== RANK_VERSION) {
    await rebuildRanking(env);
  }
}


export async function rankingRows(env, limit) {

  await ensureRanking(env);

  var result = await env.DB.prepare(
    "SELECT rank_key, user_id, player_id, display_name AS nickname, team_name, avatar_url, " +
    "upper_count, first_count, CAST(upper_rate AS INTEGER) AS upper_rate, last_date " +
    "FROM rank_stats ORDER BY upper_count DESC, upper_rate DESC, last_date DESC, display_name ASC LIMIT ?"
  )
  .bind(limit || 50)
  .all();

  return result.results || [];
}


/* 最強的三場：上位率高的在前（參賽人數越多、名次越前面越高），再比日期 */
export async function rankingHighlights(env, key) {

  var match = /^([UP])(\d{1,9})$/.exec(String(key || ""));

  /* 舊網址：直接給選手資料編號 */
  if (!match && /^\d{1,9}$/.test(String(key || ""))) {
    match = [null, "P", key];
  }

  if (!match) {
    return null;
  }

  var where = match[1] === "U" ? "p.user_id = ?" : "p.id = ?";

  var rows = await env.DB.prepare(
    "SELECT pp.event_date, pp.event_name, pp.participant_count, pp.placement, t.team_name " +
    "FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id " +
    "LEFT JOIN teams t ON t.id = p.team_id " +
    "WHERE " + where + " AND pp.participant_count >= ? AND pp.placement > 0 " +
    "ORDER BY CAST(pp.participant_count AS REAL) / pp.placement DESC, pp.event_date DESC LIMIT 3"
  )
  .bind(Number(match[2]), RANK_MIN_PLAYERS)
  .all();

  return rows.results || [];
}
