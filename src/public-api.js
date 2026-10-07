/* =========================================================
   OURSPACE
   官網公開 API
========================================================= */

import {
  API_CACHE_SECONDS,
  LIVE_CACHE_SECONDS,
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger
} from "./util.js";


/* 對外公開的賽事狀態（draft 草稿永遠不會出現在官網） */
var PUBLIC_TOURNAMENT_STATUSES = [
  "coming",
  "open",
  "closed",
  "ongoing",
  "finished"
];


export async function handlePublicApi(request, url, env) {

  var pathname = url.pathname;
  var method = request.method;

  if (method === "GET") {

    if (pathname === "/api/news") {
      return getNews(env);
    }

    if (pathname === "/api/news/images") {
      return getNewsImages(env);
    }

    if (pathname === "/api/tournaments") {
      return getTournaments(url, env);
    }

    if (pathname.indexOf("/api/tournaments/") === 0) {
      return getTournament(pathname.replace("/api/tournaments/", ""), env);
    }

    if (pathname === "/api/league") {
      return getLeague(url, env);
    }

    /* 必須放在 /api/league/:id 之前 */
    if (pathname === "/api/league/standings") {
      return getStandings(url, env);
    }

    if (pathname.indexOf("/api/league/") === 0) {
      return getLeagueMatch(pathname.replace("/api/league/", ""), env);
    }

    if (pathname === "/api/ranking") {
      return getRanking(url, env);
    }

    if (pathname.indexOf("/api/ranking/") === 0) {
      return getPlayerHighlights(pathname.replace("/api/ranking/", ""), env);
    }
  }

  if (method === "POST") {

    if (pathname === "/api/contact") {
      return createContact(request, env);
    }

    if (pathname === "/api/registrations") {

      /*
        線上報名暫不開放：
        等 LINE Login 完成，改成從登入狀態取得 user_id 再開放。
      */

      return errorResponse("REGISTRATION_REQUIRES_LOGIN", 403);
    }
  }

  return null;

}


function listResponse(result, cacheSeconds) {

  return jsonResponse(
    {
      success: true,
      data: (result && result.results) || []
    },
    200,
    cacheSeconds || API_CACHE_SECONDS
  );

}


/* =========================================================
   NEWS
========================================================= */

async function getNews(env) {

  var result =
    await env.DB.prepare(
      "SELECT " +
      "id, title, summary, content, cover_image_url, category, published_at " +
      "FROM news " +
      "WHERE status = ? " +
      "ORDER BY sort_order ASC, published_at DESC, id DESC " +
      "LIMIT 30"
    )
    .bind("published")
    .all();

  return listResponse(result);

}


async function getNewsImages(env) {

  var result =
    await env.DB.prepare(
      "SELECT id, image_url, title, subtitle, link_url " +
      "FROM news_images " +
      "WHERE status = ? " +
      "ORDER BY sort_order ASC, id ASC " +
      "LIMIT 12"
    )
    .bind("active")
    .all();

  return listResponse(result);

}


/* =========================================================
   TOURNAMENTS
========================================================= */

var TOURNAMENT_COLUMNS =
  "id, tournament_code, title, tournament_type, description, " +
  "cover_image_url, location, start_at, end_at, " +
  "registration_start_at, registration_end_at, " +
  "max_players, max_teams, entry_fee, status ";


async function getTournaments(url, env) {

  var type = url.searchParams.get("type");
  var status = url.searchParams.get("status");
  var keyword = url.searchParams.get("q");

  var sql =
    "SELECT " + TOURNAMENT_COLUMNS +
    "FROM tournaments WHERE status != 'draft'";

  var bindings = [];

  if (type) {
    sql += " AND tournament_type = ?";
    bindings.push(type);
  }

  if (status) {

    if (PUBLIC_TOURNAMENT_STATUSES.indexOf(status) === -1) {
      return errorResponse("INVALID_STATUS", 400);
    }

    sql += " AND status = ?";
    bindings.push(status);
  }

  if (keyword) {

    keyword = keyword.trim().slice(0, 50);

    if (keyword) {
      sql += " AND (title LIKE ? OR description LIKE ?)";
      bindings.push("%" + keyword + "%");
      bindings.push("%" + keyword + "%");
    }
  }

  sql +=
    " ORDER BY CASE status " +
    "WHEN 'open' THEN 0 " +
    "WHEN 'coming' THEN 1 " +
    "WHEN 'ongoing' THEN 2 " +
    "WHEN 'closed' THEN 3 " +
    "ELSE 4 END, start_at ASC, id ASC";

  var statement = env.DB.prepare(sql);

  if (bindings.length > 0) {
    statement = statement.bind.apply(statement, bindings);
  }

  return listResponse(await statement.all());

}


async function getTournament(tournamentId, env) {

  if (!isPositiveInteger(tournamentId)) {
    return errorResponse("INVALID_TOURNAMENT_ID", 400);
  }

  var tournament =
    await env.DB.prepare(
      "SELECT " + TOURNAMENT_COLUMNS +
      "FROM tournaments WHERE id = ? AND status != 'draft'"
    )
    .bind(Number(tournamentId))
    .first();

  if (!tournament) {
    return errorResponse("TOURNAMENT_NOT_FOUND", 404);
  }

  return jsonResponse(
    { success: true, data: tournament },
    200,
    API_CACHE_SECONDS
  );

}


/* =========================================================
   LEAGUE
========================================================= */

var LEAGUE_SELECT =
  "SELECT " +
  "lm.id, lm.tournament_id, t.title AS tournament_title, " +
  "lm.match_format, lm.round_number, lm.match_number, lm.scheduled_at, " +
  "lm.score_a, lm.score_b, lm.status, lm.field_name, lm.note, " +
  "ta.id AS team_a_id, ta.team_name AS team_a_name, ta.team_logo_url AS team_a_logo, " +
  "tb.id AS team_b_id, tb.team_name AS team_b_name, tb.team_logo_url AS team_b_logo, " +
  "tw.id AS winner_team_id, tw.team_name AS winner_team_name, " +
  "lm.player_a_id, COALESCE(NULLIF(pa.nickname, ''), pa.player_name) AS player_a_name, pa.avatar_url AS player_a_avatar, " +
  "lm.player_b_id, COALESCE(NULLIF(pb.nickname, ''), pb.player_name) AS player_b_name, pb.avatar_url AS player_b_avatar " +
  "FROM league_matches lm " +
  "LEFT JOIN tournaments t ON lm.tournament_id = t.id " +
  "LEFT JOIN teams ta ON lm.team_a_id = ta.id " +
  "LEFT JOIN teams tb ON lm.team_b_id = tb.id " +
  "LEFT JOIN teams tw ON lm.winner_team_id = tw.id " +
  "LEFT JOIN players pa ON lm.player_a_id = pa.id " +
  "LEFT JOIN players pb ON lm.player_b_id = pb.id " +
  "WHERE (t.status IS NULL OR t.status != 'draft') ";


async function getLeague(url, env) {

  var tournamentId = url.searchParams.get("tournament_id");
  var sql = LEAGUE_SELECT;
  var bindings = [];

  if (tournamentId) {

    if (!isPositiveInteger(tournamentId)) {
      return errorResponse("INVALID_TOURNAMENT_ID", 400);
    }

    sql += "AND lm.tournament_id = ? ";
    bindings.push(Number(tournamentId));
  }

  sql += "ORDER BY lm.scheduled_at ASC, lm.id ASC";

  var statement = env.DB.prepare(sql);

  if (bindings.length > 0) {
    statement = statement.bind.apply(statement, bindings);
  }

  /* 比分會即時更新，所以快取很短 */
  return listResponse(await statement.all(), LIVE_CACHE_SECONDS);

}


async function getLeagueMatch(matchId, env) {

  if (!isPositiveInteger(matchId)) {
    return errorResponse("INVALID_MATCH_ID", 400);
  }

  var match =
    await env.DB.prepare(LEAGUE_SELECT + "AND lm.id = ?")
    .bind(Number(matchId))
    .first();

  if (!match) {
    return errorResponse("MATCH_NOT_FOUND", 404);
  }

  return jsonResponse(
    { success: true, data: match },
    200,
    LIVE_CACHE_SECONDS
  );

}


/* =========================================================
   LEAGUE STANDINGS
   戰隊積分：依「已結束」的比賽即時計算
   規則：積分 = 比分差（例：9:0 → +9 / -9，5:4 → +1 / -1）
   分成個人賽 / 雙人賽 / 三人賽 / 戰隊賽，加總為總積分
========================================================= */

/* 把每場比賽拆成 A 隊、B 隊各一列，積分 = 自己分數 - 對手分數 */
var STANDINGS_SQL =
  "WITH sides AS ( " +
  "  SELECT tournament_id, match_format, status, team_a_id AS team_id, " +
  "    COALESCE(score_a, 0) AS own, COALESCE(score_b, 0) AS opp " +
  "  FROM league_matches WHERE team_a_id IS NOT NULL " +
  "  UNION ALL " +
  "  SELECT tournament_id, match_format, status, team_b_id AS team_id, " +
  "    COALESCE(score_b, 0) AS own, COALESCE(score_a, 0) AS opp " +
  "  FROM league_matches WHERE team_b_id IS NOT NULL " +
  "), scored AS ( " +
  "  SELECT team_id, match_format, " +
  "    CASE WHEN status = 'finished' THEN own - opp ELSE 0 END AS pts, " +
  "    CASE WHEN status = 'finished' AND own > opp THEN 1 ELSE 0 END AS win, " +
  "    CASE WHEN status = 'finished' AND own < opp THEN 1 ELSE 0 END AS loss, " +
  "    CASE WHEN status = 'finished' AND own = opp THEN 1 ELSE 0 END AS draw " +
  "  FROM sides " +
  "  WHERE tournament_id = ? AND status != 'cancelled' " +
  ") " +
  "SELECT " +
  "  t.id AS team_id, t.team_name, t.team_logo_url, " +
  "  SUM(CASE WHEN s.match_format = 'solo' THEN s.pts ELSE 0 END) AS solo_points, " +
  "  SUM(CASE WHEN s.match_format = 'duo' THEN s.pts ELSE 0 END) AS duo_points, " +
  "  SUM(CASE WHEN s.match_format = 'trio' THEN s.pts ELSE 0 END) AS trio_points, " +
  "  SUM(CASE WHEN s.match_format = 'team' THEN s.pts ELSE 0 END) AS team_points, " +
  "  SUM(s.pts) AS total_points, " +
  "  SUM(s.win) AS wins, SUM(s.loss) AS losses, SUM(s.draw) AS draws " +
  "FROM scored s " +
  "INNER JOIN teams t ON t.id = s.team_id " +
  "GROUP BY t.id " +
  "ORDER BY total_points DESC, wins DESC, t.team_name ASC";


async function getStandings(url, env) {

  var tournamentId = url.searchParams.get("tournament_id");
  var tournament = null;

  if (tournamentId) {

    if (!isPositiveInteger(tournamentId)) {
      return errorResponse("INVALID_TOURNAMENT_ID", 400);
    }

    tournament =
      await env.DB.prepare(
        "SELECT id, title, status FROM tournaments " +
        "WHERE id = ? AND status != 'draft'"
      )
      .bind(Number(tournamentId))
      .first();

  } else {

    /* 沒指定時：優先進行中的聯賽，其次是最近有比賽的 */
    tournament =
      await env.DB.prepare(
        "SELECT t.id, t.title, t.status " +
        "FROM tournaments t " +
        "INNER JOIN league_matches lm ON lm.tournament_id = t.id " +
        "WHERE t.status != 'draft' " +
        "GROUP BY t.id " +
        "ORDER BY CASE t.status " +
        "WHEN 'ongoing' THEN 0 " +
        "WHEN 'open' THEN 1 " +
        "WHEN 'closed' THEN 2 " +
        "ELSE 3 END, MAX(lm.scheduled_at) DESC " +
        "LIMIT 1"
      )
      .first();
  }

  if (!tournament) {
    return jsonResponse(
      { success: true, tournament: null, data: [] },
      200,
      LIVE_CACHE_SECONDS
    );
  }

  var result =
    await env.DB.prepare(STANDINGS_SQL)
    .bind(tournament.id)
    .all();

  return jsonResponse(
    {
      success: true,
      tournament: tournament,
      data: result.results || []
    },
    200,
    LIVE_CACHE_SECONDS
  );

}


/* =========================================================
   RANKING
   陀螺爭霸：依選手的上位紀錄累計
   排序：上位次數 → 冠軍次數 → 最近上位日期
========================================================= */

var RANKING_LIMIT = 20;


async function getRanking(url, env) {

  var result =
    await env.DB.prepare(
      "SELECT " +
      "p.id AS player_id, p.player_name, p.nickname, p.avatar_url, " +
      "t.team_name, " +
      "COUNT(pp.id) AS upper_count, " +
      "SUM(CASE WHEN pp.placement = 1 THEN 1 ELSE 0 END) AS first_count, " +
      "MAX(pp.event_date) AS last_date " +
      "FROM player_placements pp " +
      "INNER JOIN players p ON pp.player_id = p.id " +
      "LEFT JOIN teams t ON p.team_id = t.id " +
      "WHERE p.status = 'active' " +
      "GROUP BY p.id " +
      "ORDER BY upper_count DESC, first_count DESC, last_date DESC, p.player_name ASC " +
      "LIMIT ?"
    )
    .bind(RANKING_LIMIT)
    .all();

  return jsonResponse(
    { success: true, data: result.results || [] },
    200,
    API_CACHE_SECONDS
  );

}


/*
  選手最厲害的三筆上位紀錄
  排序：名次越前面越好 → 同名次比參賽人數多 → 比較新的
*/
async function getPlayerHighlights(playerId, env) {

  if (!isPositiveInteger(playerId)) {
    return errorResponse("INVALID_PLAYER_ID", 400);
  }

  var id = Number(playerId);

  var results = await env.DB.batch([

    env.DB.prepare(
      "SELECT p.id AS player_id, p.player_name, p.nickname, p.avatar_url, " +
      "t.team_name, " +
      "(SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count " +
      "FROM players p " +
      "LEFT JOIN teams t ON p.team_id = t.id " +
      "WHERE p.id = ? AND p.status = 'active'"
    ).bind(id),

    env.DB.prepare(
      "SELECT event_date, event_name, participant_count, placement " +
      "FROM player_placements " +
      "WHERE player_id = ? " +
      "ORDER BY placement ASC, participant_count DESC, event_date DESC, id DESC " +
      "LIMIT 3"
    ).bind(id)

  ]);

  var player = (results[0].results || [])[0];

  if (!player) {
    return errorResponse("PLAYER_NOT_FOUND", 404);
  }

  return jsonResponse(
    {
      success: true,
      data: player,
      highlights: results[1].results || []
    },
    200,
    API_CACHE_SECONDS
  );

}


/* =========================================================
   CONTACT
========================================================= */

async function createContact(request, env) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var name = cleanText(body.name);
  var contact = cleanText(body.contact);
  var message = cleanText(body.message);

  if (!message) {
    return errorResponse("MESSAGE_REQUIRED", 400);
  }

  if (message.length > 5000 || name.length > 100 || contact.length > 200) {
    return errorResponse("INPUT_TOO_LONG", 400);
  }

  var result =
    await env.DB.prepare(
      "INSERT INTO contact_messages (name, contact, message) VALUES (?, ?, ?)"
    )
    .bind(name || null, contact || null, message)
    .run();

  return jsonResponse(
    { success: true, id: result.meta.last_row_id },
    201
  );

}