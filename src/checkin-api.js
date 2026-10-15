/* =========================================================
   OURSPACE
   報到 / 名單 / 賽程 / 抽獎 API

   官網公開（只讀，今天與未來的公開場次）
     GET  /api/checkin/events
     GET  /api/checkin/events/:id

   後台（admin 與 referee 都可用，刪除場次限 admin）
     GET    /api/referee/checkin/events
     POST   /api/referee/checkin/events
     PUT    /api/referee/checkin/events/:id
     DELETE /api/referee/checkin/events/:id
     GET    /api/referee/checkin/events/:id/entries
     POST   /api/referee/checkin/events/:id/entries
     POST   /api/referee/checkin/events/:id/import
     PUT    /api/referee/checkin/entries/:id
     PUT    /api/referee/checkin/entries/:id/match
     DELETE /api/referee/checkin/entries/:id
     GET    /api/referee/checkin/players?q=
     GET    /api/referee/checkin/events/:id/lottery
     POST   /api/referee/checkin/events/:id/lottery
     DELETE /api/referee/checkin/lottery/:id
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow,
  taiwanToday,
  LIVE_CACHE_SECONDS
} from "./util.js";

import { requireStaff, writeAuditLog } from "./auth.js";


var MAX_NAME_LENGTH = 50;
var MAX_IMPORT_LINES = 300;
var MAX_FIELD = 5;


/* =========================================================
   入口
========================================================= */

export async function handleCheckinApi(request, url, env) {

  var parts = url.pathname.split("/").filter(Boolean);

  if (parts[1] === "checkin") {
    return handlePublic(request, parts, env);
  }

  if (parts[1] === "referee" && parts[2] === "checkin") {
    return handleStaff(request, url, parts.slice(3), env);
  }

  return null;

}


/* =========================================================
   官網公開
========================================================= */

async function handlePublic(request, parts, env) {

  if (request.method !== "GET" || parts[2] !== "events") {
    return null;
  }

  var today = taiwanToday();

  if (parts.length === 3) {

    var list = await env.DB.prepare(
      "SELECT e.id, e.event_date, e.title, e.start_time, e.note, " +
      "COUNT(c.id) AS total, " +
      "COALESCE(SUM(CASE WHEN c.checked_in = 1 THEN 1 ELSE 0 END), 0) AS checked " +
      "FROM checkin_events e " +
      "LEFT JOIN checkin_entries c ON c.event_id = e.id " +
      "WHERE e.is_public = 1 AND e.event_date >= ? " +
      "GROUP BY e.id " +
      "ORDER BY e.event_date ASC, COALESCE(e.start_time, '') ASC, e.id ASC " +
      "LIMIT 60"
    )
    .bind(today)
    .all();

    return jsonResponse(
      { success: true, today: today, data: list.results || [] },
      200,
      LIVE_CACHE_SECONDS
    );
  }

  if (parts.length !== 4 || !isPositiveInteger(parts[3])) {
    return null;
  }

  var event = await env.DB.prepare(
    "SELECT id, event_date, title, start_time, note FROM checkin_events " +
    "WHERE id = ? AND is_public = 1 AND event_date >= ?"
  )
  .bind(Number(parts[3]), today)
  .first();

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var entries = await env.DB.prepare(
    "SELECT nickname, checked_in, checkin_number, is_judge " +
    "FROM checkin_entries WHERE event_id = ? " +
    "ORDER BY checked_in DESC, checkin_number ASC, nickname ASC"
  )
  .bind(event.id)
  .all();

  event.entries = entries.results || [];

  return jsonResponse({ success: true, data: event }, 200, LIVE_CACHE_SECONDS);

}


/* =========================================================
   後台
========================================================= */

async function handleStaff(request, url, parts, env) {

  var auth = await requireStaff(request, env, ["admin", "referee"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;
  var resource = parts[0];
  var id = parts[1];
  var action = parts[2];

  if (parts.length > 3) {
    return null;
  }

  if (resource === "players" && parts.length === 1 && method === "GET") {
    return searchPlayers(url, env);
  }

  if (resource === "events" && parts.length === 1) {

    if (method === "GET") {
      return listEvents(env);
    }

    if (method === "POST") {
      return saveEvent(request, env, staff, null);
    }

    return null;
  }

  if (id === undefined || !isPositiveInteger(id)) {
    return null;
  }

  id = Number(id);

  if (resource === "events") {

    if (!action) {

      if (method === "PUT") {
        return saveEvent(request, env, staff, id);
      }

      if (method === "DELETE") {
        return deleteEvent(env, staff, id);
      }

      return null;
    }

    if (action === "entries" && method === "GET") {
      return listEntries(env, id);
    }

    if (action === "entries" && method === "POST") {
      return addEntry(request, env, staff, id);
    }

    if (action === "import" && method === "POST") {
      return importEntries(request, env, staff, id);
    }

    if (action === "lottery" && method === "GET") {
      return lotteryStatus(env, id);
    }

    if (action === "lottery" && method === "POST") {
      return drawLottery(request, env, staff, id);
    }

    return null;
  }

  if (resource === "entries") {

    if (!action && method === "PUT") {
      return updateEntry(request, env, staff, id);
    }

    if (action === "match" && method === "PUT") {
      return updateMatch(request, env, id);
    }

    if (!action && method === "DELETE") {
      return deleteEntry(env, staff, id);
    }

    return null;
  }

  if (resource === "lottery" && !action && method === "DELETE") {
    return deleteWin(env, staff, id);
  }

  return null;

}


/* =========================================================
   驗證
========================================================= */

function validName(name) {

  if (!name || name.length > MAX_NAME_LENGTH) {
    return false;
  }

  /* 控制字元與 < > 不允許 */
  return !/[\u0000-\u001f\u007f<>]/.test(name);

}


function toInt(value, min, max) {

  if (value === undefined || value === null || value === "") {
    return null;
  }

  var number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    return NaN;
  }

  return number;

}


function uniqueError(error) {

  var message = String(error && error.message);

  if (message.indexOf("UNIQUE") === -1) {
    return null;
  }

  if (message.indexOf("checkin_number") !== -1) {
    return errorResponse("DUPLICATE_NUMBER", 409, { field: "checkin_number" });
  }

  return errorResponse("DUPLICATE_NAME", 409, { field: "nickname" });

}


async function getEvent(env, id) {

  return env.DB.prepare("SELECT * FROM checkin_events WHERE id = ?")
    .bind(id)
    .first();

}


var ENTRY_SELECT =
  "SELECT c.id, c.event_id, c.nickname, c.player_id, c.checked_in, c.checkin_number, " +
  "c.is_judge, c.match_schedule, c.match_status, c.match_field, c.checked_in_at, " +
  "CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS has_won " +
  "FROM checkin_entries c " +
  "LEFT JOIN checkin_lottery_wins w ON w.entry_id = c.id AND w.event_id = c.event_id ";


async function getEntry(env, id) {

  return env.DB.prepare(ENTRY_SELECT + "WHERE c.id = ?")
    .bind(id)
    .first();

}


/* =========================================================
   場次
========================================================= */

async function listEvents(env) {

  var today = taiwanToday();

  var result = await env.DB.prepare(
    "SELECT e.*, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id) AS total, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id AND c.checked_in = 1) AS checked " +
    "FROM checkin_events e " +
    "WHERE e.event_date >= date(?, '-60 days') " +
    "ORDER BY e.event_date ASC, COALESCE(e.start_time, '') ASC, e.id ASC"
  )
  .bind(today)
  .all();

  return jsonResponse({
    success: true,
    today: today,
    data: result.results || []
  });

}


async function saveEvent(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var eventDate = cleanText(body.event_date);
  var title = cleanText(body.title);
  var startTime = cleanText(body.start_time);
  var note = cleanText(body.note);
  var minPlayers = toInt(body.lottery_min_players, 0, 999);
  var isPublic = body.is_public === 0 || body.is_public === "0" || body.is_public === false ? 0 : 1;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return errorResponse("INVALID_DATE", 400, { field: "event_date" });
  }

  if (!title) {
    return errorResponse("REQUIRED", 400, { field: "title" });
  }

  if (!validName(title)) {
    return errorResponse("INVALID_NAME", 400, { field: "title" });
  }

  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
    return errorResponse("INVALID_TIME", 400, { field: "start_time" });
  }

  if (note.length > 200) {
    return errorResponse("TOO_LONG", 400, { field: "note" });
  }

  if (Number.isNaN(minPlayers)) {
    return errorResponse("INVALID_NUMBER", 400, { field: "lottery_min_players" });
  }

  var values = [eventDate, title, startTime || null, minPlayers || 0, isPublic, note || null];

  if (id === null) {

    var insert = await env.DB.prepare(
      "INSERT INTO checkin_events " +
      "(event_date, title, start_time, lottery_min_players, is_public, note) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(values[0], values[1], values[2], values[3], values[4], values[5])
    .run();

    id = insert.meta.last_row_id;

    await writeAuditLog(env, staff, "create", "checkin_events", id, { date: eventDate, title: title });

  } else {

    var update = await env.DB.prepare(
      "UPDATE checkin_events SET " +
      "event_date = ?, title = ?, start_time = ?, lottery_min_players = ?, " +
      "is_public = ?, note = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE id = ?"
    )
    .bind(values[0], values[1], values[2], values[3], values[4], values[5], id)
    .run();

    if (!update.meta.changes) {
      return errorResponse("EVENT_NOT_FOUND", 404);
    }

    await writeAuditLog(env, staff, "update", "checkin_events", id, { date: eventDate, title: title });
  }

  return jsonResponse({ success: true, data: await getEvent(env, id) });

}


async function deleteEvent(env, staff, id) {

  if (staff.role !== "admin") {
    return errorResponse("FORBIDDEN", 403);
  }

  var event = await getEvent(env, id);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_entries WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_events WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "delete", "checkin_events", id, {
    date: event.event_date,
    title: event.title
  });

  return jsonResponse({ success: true });

}


/* =========================================================
   名單
========================================================= */

async function listEntries(env, eventId) {

  var event = await getEvent(env, eventId);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var result = await env.DB.prepare(
    ENTRY_SELECT +
    "WHERE c.event_id = ? " +
    "ORDER BY c.checked_in DESC, c.checkin_number ASC, c.nickname ASC"
  )
  .bind(eventId)
  .all();

  return jsonResponse({
    success: true,
    event: event,
    data: result.results || []
  });

}


async function addEntry(request, env, staff, eventId) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var nickname = cleanText(body.nickname);
  var playerId = isPositiveInteger(body.player_id) ? Number(body.player_id) : null;

  if (!nickname) {
    return errorResponse("REQUIRED", 400, { field: "nickname" });
  }

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  if (!(await getEvent(env, eventId))) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  try {

    var result = await env.DB.prepare(
      "INSERT INTO checkin_entries (event_id, nickname, player_id) VALUES (?, ?, ?)"
    )
    .bind(eventId, nickname, playerId)
    .run();

    return jsonResponse({ success: true, data: await getEntry(env, result.meta.last_row_id) }, 201);

  } catch (error) {

    var unique = uniqueError(error);

    if (unique) {
      return unique;
    }

    throw error;
  }

}


async function importEntries(request, env, staff, eventId) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  if (!(await getEvent(env, eventId))) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var prefix = cleanText(body.team_prefix);
  var lines = String(body.text || "").split(/\r?\n/);
  var names = [];
  var seen = {};
  var invalid = [];
  var duplicates = 0;

  lines.forEach(function (line) {

    var name = cleanText(line);

    if (!name) {
      return;
    }

    name = prefix + name;

    if (!validName(name)) {
      invalid.push(name.slice(0, 30));
      return;
    }

    var key = name.toLowerCase();

    if (seen[key]) {
      duplicates++;
      return;
    }

    seen[key] = true;
    names.push(name);
  });

  if (!names.length) {
    return errorResponse("NOTHING_TO_IMPORT", 400, { invalid: invalid });
  }

  if (names.length > MAX_IMPORT_LINES) {
    return errorResponse("TOO_MANY_LINES", 400);
  }

  var statement = env.DB.prepare(
    "INSERT OR IGNORE INTO checkin_entries (event_id, nickname) VALUES (?, ?)"
  );

  var results = await env.DB.batch(
    names.map(function (name) {
      return statement.bind(eventId, name);
    })
  );

  var imported = 0;

  results.forEach(function (result) {
    imported += result.meta.changes || 0;
  });

  duplicates += names.length - imported;

  await writeAuditLog(env, staff, "import", "checkin_events", eventId, { imported: imported });

  return jsonResponse({
    success: true,
    imported: imported,
    duplicates: duplicates,
    invalid: invalid
  });

}


async function updateEntry(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var checked = Number(body.checked_in) === 1 ? 1 : 0;
  var judge = Number(body.is_judge) === 1 ? 1 : 0;
  var number = toInt(body.checkin_number, 1, 9999);
  var nickname = body.nickname === undefined ? null : cleanText(body.nickname);

  if (Number.isNaN(number)) {
    return errorResponse("INVALID_NUMBER", 400, { field: "checkin_number" });
  }

  if (nickname !== null && !validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  var statement;

  if (checked) {

    /* 號碼留空：沿用原本號碼，沒有就自動取「本場最大號 + 1」（同一個指令完成，兩人同時報到也不會撞號） */
    statement = env.DB.prepare(
      "UPDATE checkin_entries SET " +
      "nickname = COALESCE(?, nickname), " +
      "checked_in = 1, is_judge = ?, " +
      "checkin_number = COALESCE(?, checkin_number, " +
      "(SELECT COALESCE(MAX(e2.checkin_number), 0) + 1 FROM checkin_entries e2 " +
      "WHERE e2.event_id = checkin_entries.event_id)), " +
      "checked_in_at = COALESCE(checked_in_at, ?) " +
      "WHERE id = ?"
    )
    .bind(nickname, judge, number, taiwanNow(), id);

  } else {

    statement = env.DB.prepare(
      "UPDATE checkin_entries SET " +
      "nickname = COALESCE(?, nickname), " +
      "checked_in = 0, is_judge = ?, checkin_number = NULL, checked_in_at = NULL " +
      "WHERE id = ?"
    )
    .bind(nickname, judge, id);
  }

  try {

    var result = await statement.run();

    if (!result.meta.changes) {
      return errorResponse("ENTRY_NOT_FOUND", 404);
    }

  } catch (error) {

    var unique = uniqueError(error);

    if (unique) {
      return unique;
    }

    throw error;
  }

  return jsonResponse({ success: true, data: await getEntry(env, id) });

}


async function updateMatch(request, env, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var schedule = toInt(body.match_schedule, 0, 999);
  var status = toInt(body.match_status, 0, 2);
  var field = toInt(body.match_field, 0, MAX_FIELD);

  if (schedule === null || Number.isNaN(schedule) ||
      status === null || Number.isNaN(status) ||
      field === null || Number.isNaN(field)) {
    return errorResponse("INVALID_NUMBER", 400);
  }

  var result = await env.DB.prepare(
    "UPDATE checkin_entries SET match_schedule = ?, match_status = ?, match_field = ? " +
    "WHERE id = ?"
  )
  .bind(schedule, status, field, id)
  .run();

  if (!result.meta.changes) {
    return errorResponse("ENTRY_NOT_FOUND", 404);
  }

  return jsonResponse({ success: true, data: await getEntry(env, id) });

}


async function deleteEntry(env, staff, id) {

  var entry = await getEntry(env, id);

  if (!entry) {
    return errorResponse("ENTRY_NOT_FOUND", 404);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE entry_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_entries WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "delete", "checkin_entries", id, {
    event_id: entry.event_id,
    nickname: entry.nickname
  });

  return jsonResponse({ success: true });

}


/* 新增報名時，從官網選手資料找名字 */
async function searchPlayers(url, env) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);

  if (!keyword) {
    return jsonResponse({ success: true, data: [] });
  }

  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";

  var result = await env.DB.prepare(
    "SELECT p.id, p.player_name, p.nickname, t.team_name " +
    "FROM players p LEFT JOIN teams t ON p.team_id = t.id " +
    "WHERE p.status = 'active' " +
    "AND (p.nickname LIKE ? ESCAPE '\\' OR p.player_name LIKE ? ESCAPE '\\') " +
    "ORDER BY p.nickname ASC LIMIT 8"
  )
  .bind(like, like)
  .all();

  return jsonResponse({ success: true, data: result.results || [] });

}


/* =========================================================
   抽獎
========================================================= */

async function lotteryData(env, event) {

  var results = await env.DB.batch([

    env.DB.prepare(
      "SELECT " +
      "COALESCE(SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END), 0) AS checked_count, " +
      "COALESCE(SUM(CASE WHEN checked_in = 1 AND id NOT IN " +
      "(SELECT entry_id FROM checkin_lottery_wins WHERE event_id = ?) THEN 1 ELSE 0 END), 0) AS eligible_count " +
      "FROM checkin_entries WHERE event_id = ?"
    ).bind(event.id, event.id),

    env.DB.prepare(
      "SELECT w.id, w.prize, w.drawn_at, c.id AS entry_id, c.nickname, c.checkin_number, c.is_judge " +
      "FROM checkin_lottery_wins w " +
      "INNER JOIN checkin_entries c ON w.entry_id = c.id " +
      "WHERE w.event_id = ? ORDER BY w.id DESC"
    ).bind(event.id)

  ]);

  var counts = (results[0].results || [])[0] || {};

  return {
    event_id: event.id,
    threshold: Number(event.lottery_min_players) || 0,
    checked_count: Number(counts.checked_count) || 0,
    eligible_count: Number(counts.eligible_count) || 0,
    wins: results[1].results || []
  };

}


async function lotteryStatus(env, eventId) {

  var event = await getEvent(env, eventId);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  return jsonResponse({ success: true, data: await lotteryData(env, event) });

}


async function drawLottery(request, env, staff, eventId) {

  var body = (await parseJsonBody(request)) || {};
  var prize = cleanText(body.prize).slice(0, MAX_NAME_LENGTH);

  var event = await getEvent(env, eventId);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var before = await lotteryData(env, event);

  /* 報到人數未達門檻：前端要先跳提醒、使用者確認後才會帶 confirm_below_threshold */
  if (before.threshold > 0 && before.checked_count < before.threshold && body.confirm_below_threshold !== true) {
    return errorResponse("BELOW_THRESHOLD", 409, { data: before });
  }

  if (!before.eligible_count) {
    return errorResponse("NO_ELIGIBLE", 409, { data: before });
  }

  /* 一個指令完成「隨機挑人 + 寫入中獎」，兩台裝置同時抽也不會重複 */
  var result = await env.DB.prepare(
    "INSERT INTO checkin_lottery_wins (event_id, entry_id, prize, drawn_by) " +
    "SELECT ?, c.id, ?, ? FROM checkin_entries c " +
    "WHERE c.event_id = ? AND c.checked_in = 1 " +
    "AND NOT EXISTS (SELECT 1 FROM checkin_lottery_wins w WHERE w.event_id = c.event_id AND w.entry_id = c.id) " +
    "ORDER BY RANDOM() LIMIT 1"
  )
  .bind(eventId, prize || null, staff.id, eventId)
  .run();

  if (!result.meta.changes) {
    return errorResponse("NO_ELIGIBLE", 409, { data: await lotteryData(env, event) });
  }

  var winId = result.meta.last_row_id;

  var winner = await env.DB.prepare(
    "SELECT w.id, w.prize, w.drawn_at, c.id AS entry_id, c.nickname, c.checkin_number, c.is_judge " +
    "FROM checkin_lottery_wins w INNER JOIN checkin_entries c ON w.entry_id = c.id " +
    "WHERE w.id = ?"
  )
  .bind(winId)
  .first();

  await writeAuditLog(env, staff, "lottery", "checkin_events", eventId, {
    nickname: winner && winner.nickname,
    prize: prize
  });

  return jsonResponse({
    success: true,
    winner: winner,
    data: await lotteryData(env, event)
  });

}


async function deleteWin(env, staff, id) {

  var win = await env.DB.prepare("SELECT * FROM checkin_lottery_wins WHERE id = ?")
    .bind(id)
    .first();

  if (!win) {
    return errorResponse("WIN_NOT_FOUND", 404);
  }

  await env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE id = ?").bind(id).run();

  await writeAuditLog(env, staff, "lottery_undo", "checkin_lottery_wins", id, { entry_id: win.entry_id });

  return jsonResponse({ success: true });

}
