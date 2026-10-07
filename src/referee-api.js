/* =========================================================
   OURSPACE
   裁判 API（admin 與 referee 都可用）
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanToday,
  MAX_TOTAL_SCORE
} from "./util.js";

import { requireStaff, writeAuditLog } from "./auth.js";


var MATCH_SELECT =
  "SELECT " +
  "lm.id, lm.tournament_id, t.title AS tournament_title, " +
  "lm.match_format, lm.round_number, lm.match_number, lm.scheduled_at, " +
  "lm.score_a, lm.score_b, lm.status, lm.field_name, lm.note, " +
  "lm.team_a_id, ta.team_name AS team_a_name, " +
  "lm.team_b_id, tb.team_name AS team_b_name, " +
  "lm.player_a_id, COALESCE(NULLIF(pa.nickname, ''), pa.player_name) AS player_a_name, " +
  "lm.player_b_id, COALESCE(NULLIF(pb.nickname, ''), pb.player_name) AS player_b_name, " +
  "lm.winner_team_id, lm.updated_at " +
  "FROM league_matches lm " +
  "LEFT JOIN tournaments t ON lm.tournament_id = t.id " +
  "LEFT JOIN teams ta ON lm.team_a_id = ta.id " +
  "LEFT JOIN teams tb ON lm.team_b_id = tb.id " +
  "LEFT JOIN players pa ON lm.player_a_id = pa.id " +
  "LEFT JOIN players pb ON lm.player_b_id = pb.id ";


/* 依比分判定勝方（平手 = NULL） */
var WINNER_SQL =
  "winner_team_id = CASE " +
  "WHEN COALESCE(score_a, 0) > COALESCE(score_b, 0) THEN team_a_id " +
  "WHEN COALESCE(score_b, 0) > COALESCE(score_a, 0) THEN team_b_id " +
  "ELSE NULL END";


/*
  各狀態操作：允許的目前狀態 + 要執行的 SET
  scheduled → live ⇄ paused → finished → (reopen) live
*/
var STATUS_ACTIONS = {

  start: {
    from: ["scheduled"],
    set:
      "status = 'live', " +
      "score_a = COALESCE(score_a, 0), " +
      "score_b = COALESCE(score_b, 0), " +
      "winner_team_id = NULL"
  },

  pause: {
    from: ["live"],
    set: "status = 'paused'"
  },

  resume: {
    from: ["paused"],
    set: "status = 'live'"
  },

  /* 兩隊比分加總剛好 MAX_TOTAL_SCORE 才能結束（9 是奇數，所以不會平手） */
  finish: {
    from: ["live", "paused"],
    where: "COALESCE(score_a, 0) + COALESCE(score_b, 0) = " + Number(MAX_TOTAL_SCORE),
    error: "SCORE_NOT_COMPLETE",
    set: "status = 'finished', " + WINNER_SQL
  },

  reopen: {
    from: ["finished"],
    set: "status = 'live', winner_team_id = NULL"
  }

};


export async function handleRefereeApi(request, url, env) {

  var auth = await requireStaff(request, env, ["admin", "referee"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;

  /* ["api", "referee", "matches", id?, action?] */
  var parts = url.pathname.split("/").filter(Boolean);

  if (parts[2] !== "matches" || parts.length > 5) {
    return null;
  }

  if (parts.length === 3 && method === "GET") {
    return listMatches(url, env);
  }

  var id = parts[3];

  if (!isPositiveInteger(id)) {
    return errorResponse("INVALID_MATCH_ID", 400);
  }

  id = Number(id);

  if (parts.length === 4 && method === "GET") {
    return matchResponse(env, id);
  }

  if (parts[4] === "score" && method === "POST") {
    return changeScore(request, env, staff, id);
  }

  if (parts[4] === "status" && method === "POST") {
    return changeStatus(request, env, staff, id);
  }

  return null;

}


async function getMatch(env, id) {

  return env.DB.prepare(MATCH_SELECT + "WHERE lm.id = ?")
    .bind(id)
    .first();

}


async function matchResponse(env, id) {

  var match = await getMatch(env, id);

  if (!match) {
    return errorResponse("MATCH_NOT_FOUND", 404);
  }

  return jsonResponse({ success: true, data: match });

}


/* 指定日期的比賽 + 任何進行中 / 暫停中的比賽 */
async function listMatches(url, env) {

  var date = cleanText(url.searchParams.get("date"));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = taiwanToday();
  }

  var results = await env.DB.batch([

    env.DB.prepare(
      MATCH_SELECT +
      "WHERE substr(lm.scheduled_at, 1, 10) = ? OR lm.status IN ('live', 'paused') " +
      "ORDER BY lm.scheduled_at ASC, lm.id ASC"
    ).bind(date),

    env.DB.prepare(
      "SELECT DISTINCT substr(scheduled_at, 1, 10) AS match_date " +
      "FROM league_matches " +
      "WHERE substr(scheduled_at, 1, 10) >= date(?, '-30 days') " +
      "ORDER BY match_date ASC LIMIT 60"
    ).bind(taiwanToday())

  ]);

  return jsonResponse({
    success: true,
    date: date,
    today: taiwanToday(),
    max_total_score: MAX_TOTAL_SCORE,
    dates: (results[1].results || []).map(function (row) {
      return row.match_date;
    }),
    data: results[0].results || []
  });

}


/*
  加減分：用 SQL 直接加減，兩位裁判同時按也不會互相蓋掉。
  加分時檢查兩隊比分加總不能超過 MAX_TOTAL_SCORE（減分不受限制）。
*/
async function changeScore(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var column = body.side === "a" ? "score_a" : body.side === "b" ? "score_b" : null;
  var delta = Number(body.delta);

  if (!column) {
    return errorResponse("INVALID_SIDE", 400);
  }

  if (delta !== 1 && delta !== -1) {
    return errorResponse("INVALID_DELTA", 400);
  }

  var result =
    await env.DB.prepare(
      "UPDATE league_matches SET " +
      column + " = MAX(0, COALESCE(" + column + ", 0) + ?), " +
      "updated_at = CURRENT_TIMESTAMP " +
      "WHERE id = ? AND status = 'live' " +
      "AND (? < 0 OR COALESCE(score_a, 0) + COALESCE(score_b, 0) < ?)"
    )
    .bind(delta, id, delta, MAX_TOTAL_SCORE)
    .run();

  var match = await getMatch(env, id);

  if (!match) {
    return errorResponse("MATCH_NOT_FOUND", 404);
  }

  if (!result.meta.changes) {

    if (match.status !== "live") {
      return errorResponse("MATCH_NOT_LIVE", 409, { data: match });
    }

    return errorResponse("SCORE_LIMIT", 409, { data: match });
  }

  await writeAuditLog(env, staff, "score", "league_matches", id, {
    side: body.side,
    delta: delta,
    score_a: match.score_a,
    score_b: match.score_b
  });

  return jsonResponse({ success: true, data: match });

}


async function changeStatus(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var action = Object.prototype.hasOwnProperty.call(STATUS_ACTIONS, body.action)
    ? STATUS_ACTIONS[body.action]
    : null;

  if (!action) {
    return errorResponse("INVALID_ACTION", 400);
  }

  var allowed = action.from
    .map(function (status) {
      return "'" + status + "'";
    })
    .join(", ");

  var result =
    await env.DB.prepare(
      "UPDATE league_matches SET " + action.set +
      ", updated_at = CURRENT_TIMESTAMP " +
      "WHERE id = ? AND status IN (" + allowed + ")" +
      (action.where ? " AND " + action.where : "")
    )
    .bind(id)
    .run();

  var match = await getMatch(env, id);

  if (!match) {
    return errorResponse("MATCH_NOT_FOUND", 404);
  }

  if (!result.meta.changes) {

    /* 狀態對，但沒達到額外條件（例如比分還沒滿 9 分） */
    if (action.error && action.from.indexOf(match.status) !== -1) {
      return errorResponse(action.error, 409, { data: match });
    }

    return errorResponse("INVALID_MATCH_STATE", 409, { data: match });
  }

  await writeAuditLog(env, staff, "status_" + body.action, "league_matches", id, {
    score_a: match.score_a,
    score_b: match.score_b,
    winner_team_id: match.winner_team_id
  });

  return jsonResponse({ success: true, data: match });

}