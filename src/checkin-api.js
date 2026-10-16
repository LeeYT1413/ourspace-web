/* =========================================================
   OURSPACE
   場次管理 / 報到 / 賽後紀錄 / 抽獎 / 網站設定 API

   官網公開（只讀）
     GET  /api/checkin/events              今天與之後的公開場次
     GET  /api/checkin/events/:id          場次與報名名單
     GET  /api/checkin/site                網站設定（營業時間、地址、社群、關於我們）
     GET  /api/checkin/images/:id          後台上傳的圖片
     GET  /api/checkin/highlights          最近封存場次的上位者（首頁「恭喜上位」）
     POST /api/checkin/register            線上報名（非會員也可以；一次多場、多人）

   後台（/api/referee/checkin/*，依 ERP「官網後台」頁面權限）
     events          場次管理：場次、比賽結束、賽後紀錄、封存
     checkin         報到：名單、批次報到、匯入
     lottery         抽獎
     site_settings   網站設定
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow,
  taiwanToday,
  LIVE_CACHE_SECONDS,
  API_CACHE_SECONDS
} from "./util.js";

import { requireStaff, writeAuditLog, canUsePage, MANAGER_ROLES } from "./auth.js";


var MAX_NAME_LENGTH = 50;
var MAX_TEXT_LENGTH = 2000;
var MAX_IMPORT_LINES = 300;
var MAX_LIST_ITEMS = 30;
var MAX_IMAGE_CHARS = 1400000;   /* base64 約 1 MB */

var EVENT_TYPES = ["daily", "big"];
var PRESET_KEYS = ["bonus", "rules", "special", "notes"];


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
   共用
========================================================= */

function validName(name) {

  if (!name || name.length > MAX_NAME_LENGTH) {
    return false;
  }

  return !/[\u0000-\u001f\u007f<>]/.test(name);

}


function cleanLong(value) {

  var text = String(value === undefined || value === null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

  return text.slice(0, MAX_TEXT_LENGTH);

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


function imageUrl(id) {
  return id ? "/api/checkin/images/" + id : null;
}


/* 海報：後台上傳的圖片優先，其次是舊賽事搬過來的網址 */
function posterOf(row) {
  return imageUrl(row.poster_image_id) || row.poster_link || null;
}


var SIGNUP_WINDOW_MINUTES = 10;
var SIGNUP_MAX_PER_WINDOW = 6;
var SIGNUP_MAX_NAMES = 10;
var SIGNUP_MAX_EVENTS = 10;


async function sha256Hex(text) {

  var bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));

  return Array.from(new Uint8Array(bytes))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");

}


/* 冠軍 / 亞軍 / 季軍 / 第 N 名 → 名次數字；其他（例如最佳新人）回 null */
function rankNumber(label) {

  label = cleanText(label);

  if (/^(冠軍|第\s*1\s*名|第一名)$/.test(label)) {
    return 1;
  }

  if (/^(亞軍|第\s*2\s*名|第二名)$/.test(label)) {
    return 2;
  }

  if (/^(季軍|殿軍|第\s*3\s*名|第三名)$/.test(label)) {
    return 3;
  }

  var match = label.match(/^第\s*(\d{1,3})\s*名$/);

  return match ? Number(match[1]) : null;

}


async function getEvent(env, id) {

  return env.DB.prepare("SELECT * FROM checkin_events WHERE id = ?")
    .bind(id)
    .first();

}


function archivedError() {
  return errorResponse("ARCHIVED", 409);
}


async function getOpenEvent(env, id) {

  var event = await getEvent(env, id);

  if (!event) {
    return { response: errorResponse("EVENT_NOT_FOUND", 404) };
  }

  if (event.archived_at) {
    return { response: archivedError() };
  }

  return { event: event };

}


async function getEntryEvent(env, entryId) {

  return env.DB.prepare(
    "SELECT e.* FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id WHERE c.id = ?"
  )
  .bind(entryId)
  .first();

}


async function getSetting(env, key, fallback) {

  var row = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = ?")
    .bind(key)
    .first();

  if (!row) {
    return fallback;
  }

  try {
    return JSON.parse(row.setting_value);
  } catch (error) {
    return fallback;
  }

}


function cleanList(list, mapper) {

  if (!Array.isArray(list)) {
    return [];
  }

  return list.slice(0, MAX_LIST_ITEMS).map(mapper).filter(Boolean);

}


/* =========================================================
   官網公開
========================================================= */

async function handlePublic(request, parts, env) {

  if (request.method === "POST" && parts[2] === "register" && parts.length === 3) {
    return publicRegister(request, env);
  }

  if (request.method !== "GET") {
    return null;
  }

  if (parts[2] === "highlights" && parts.length === 3) {
    return publicHighlights(env);
  }

  if (parts[2] === "images" && parts.length === 4 && isPositiveInteger(parts[3])) {
    return serveImage(env, Number(parts[3]));
  }

  if (parts[2] === "site" && parts.length === 3) {
    return publicSite(env);
  }

  if (parts[2] !== "events") {
    return null;
  }

  var today = taiwanToday();

  if (parts.length === 3) {

    var list = await env.DB.prepare(
      "SELECT e.id, e.event_date, e.title, e.start_time, e.note, e.event_type, e.fee, e.capacity, " +
      "e.reg_deadline, e.poster_image_id, e.poster_link, e.archived_at, " +
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

    var rows = (list.results || []).map(function (row) {
      row.poster_url = posterOf(row);
      delete row.poster_link;
      return row;
    });

    return jsonResponse({ success: true, today: today, data: rows }, 200, LIVE_CACHE_SECONDS);
  }

  if (parts.length !== 4 || !isPositiveInteger(parts[3])) {
    return null;
  }

  var event = await env.DB.prepare(
    "SELECT id, event_date, title, start_time, note, event_type, fee, capacity, reg_deadline, " +
    "poster_image_id, poster_link, bonus_text, rules_text, special_text, notes_text, archived_at " +
    "FROM checkin_events WHERE id = ? AND is_public = 1 AND event_date >= ?"
  )
  .bind(Number(parts[3]), today)
  .first();

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT c.nickname, c.checked_in, c.checkin_number, c.is_judge, t.team_name " +
      "FROM checkin_entries c " +
      "LEFT JOIN players p ON p.id = c.player_id " +
      "LEFT JOIN teams t ON t.id = p.team_id " +
      "WHERE c.event_id = ? ORDER BY c.id ASC"
    ).bind(event.id),
    env.DB.prepare(
      "SELECT rank_label, prize FROM checkin_event_prizes WHERE event_id = ? ORDER BY sort ASC, id ASC"
    ).bind(event.id)
  ]);

  event.poster_url = posterOf(event);
  delete event.poster_link;
  event.entries = results[0].results || [];
  event.prizes = results[1].results || [];

  return jsonResponse({ success: true, data: event }, 200, LIVE_CACHE_SECONDS);

}


async function serveImage(env, id) {

  var row = await env.DB.prepare("SELECT mime, data FROM site_images WHERE id = ?")
    .bind(id)
    .first();

  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  var binary = atob(row.data);
  var bytes = new Uint8Array(binary.length);

  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });

}


async function publicSite(env) {

  var result = await env.DB.prepare(
    "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('store', 'socials', 'about')"
  ).all();

  var data = {};

  (result.results || []).forEach(function (row) {
    try {
      data[row.setting_key] = JSON.parse(row.setting_value);
    } catch (error) {
      data[row.setting_key] = null;
    }
  });

  if (data.about) {
    data.about.image_url = imageUrl(data.about.image_id);
  }

  return jsonResponse({ success: true, data: data }, 200, API_CACHE_SECONDS);

}


/* =========================================================
   後台：路由
========================================================= */

async function handleStaff(request, url, parts, env) {

  var auth = await requireStaff(request, env, ["events", "checkin", "lottery", "site_settings"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;
  var resource = parts[0];
  var id = parts[1];
  var action = parts[2];
  var extra = parts[3];

  function need(page) {
    return canUsePage(staff, page) ? null : errorResponse("FORBIDDEN", 403);
  }

  if (parts.length > 4) {
    return null;
  }

  /* ---------- 網站設定 / 圖片 / 選手 ---------- */

  if (resource === "site" && parts.length === 1) {

    if (method === "GET") {
      return need(["site_settings", "events"]) || getSite(env);
    }

    if (method === "PUT") {
      return need("site_settings") || saveSite(request, env, staff);
    }

    return null;
  }

  if (resource === "images" && parts.length === 1 && method === "POST") {
    return need(["events", "site_settings"]) || uploadImage(request, env, staff);
  }

  if (resource === "players" && parts.length === 1 && method === "GET") {
    return need("checkin") || searchPlayers(url, env);
  }

  /* ---------- 場次 ---------- */

  if (resource === "events" && parts.length === 1) {

    if (method === "GET") {
      return listEvents(env);
    }

    if (method === "POST") {
      return need("events") || saveEvent(request, env, staff, null);
    }

    return null;
  }

  if (id === undefined || !isPositiveInteger(id)) {
    return null;
  }

  id = Number(id);

  if (resource === "events") {

    if (!action) {

      if (method === "GET") {
        return getEventDetail(env, id);
      }

      if (method === "PUT") {
        return need("events") || saveEvent(request, env, staff, id);
      }

      if (method === "DELETE") {
        return need("events") || deleteEvent(env, staff, id);
      }

      return null;
    }

    if (action === "end" && method === "POST" && !extra) {
      return need("events") || endEvent(env, staff, id);
    }

    if (action === "settle" && !extra && method === "GET") {
      return need("events") || getSettle(env, id);
    }

    if (action === "settle" && !extra && method === "PUT") {
      return need("events") || saveSettle(request, env, staff, id, false);
    }

    if (action === "archive" && !extra && method === "POST") {
      return need("events") || saveSettle(request, env, staff, id, true);
    }

    if (action === "unarchive" && !extra && method === "POST") {
      return unarchive(env, staff, id);
    }

    if (action === "entries" && !extra && method === "GET") {
      return need(["checkin", "events"]) || listEntries(env, id);
    }

    if (action === "entries" && !extra && method === "POST") {
      return need("checkin") || addEntry(request, env, id);
    }

    if (action === "entries" && extra === "batch" && method === "PUT") {
      return need("checkin") || batchUpdate(request, env, staff, id);
    }

    if (action === "import" && !extra && method === "POST") {
      return need("checkin") || importEntries(request, env, staff, id);
    }

    if (action === "lottery" && !extra && method === "GET") {
      return need("lottery") || lotteryStatus(env, id);
    }

    if (action === "lottery" && !extra && method === "POST") {
      return need("lottery") || drawLottery(request, env, staff, id);
    }

    return null;
  }

  if (resource === "entries" && !action && method === "DELETE") {
    return need("checkin") || deleteEntry(env, staff, id);
  }

  if (resource === "lottery" && !action && method === "DELETE") {
    return need("lottery") || deleteWin(env, staff, id);
  }

  return null;

}


/* =========================================================
   場次
========================================================= */

function eventGroup(event, today) {

  if (event.archived_at) {
    return "archived";
  }

  if (event.ended_at || event.event_date < today) {
    return "pending";
  }

  return "upcoming";

}


async function listEvents(env) {

  var today = taiwanToday();

  var result = await env.DB.prepare(
    "SELECT e.id, e.event_date, e.title, e.start_time, e.event_type, e.is_public, e.fee, e.capacity, " +
    "e.ended_at, e.archived_at, e.settled_at, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id) AS total, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id AND c.checked_in = 1) AS checked, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id AND c.player_id IS NOT NULL) AS linked " +
    "FROM checkin_events e " +
    "WHERE e.event_date >= date(?, '-60 days') OR e.archived_at IS NULL " +
    "ORDER BY e.event_date ASC, COALESCE(e.start_time, '') ASC, e.id ASC"
  )
  .bind(today)
  .all();

  var rows = (result.results || []).map(function (row) {
    row.group = eventGroup(row, today);
    return row;
  });

  return jsonResponse({ success: true, today: today, data: rows });

}


async function getEventDetail(env, id) {

  var event = await getEvent(env, id);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var results = await env.DB.batch([
    env.DB.prepare("SELECT id, rank_label, prize FROM checkin_event_prizes WHERE event_id = ? ORDER BY sort, id").bind(id),
    env.DB.prepare("SELECT id, min_players, prize, qty FROM checkin_lottery_tiers WHERE event_id = ? ORDER BY sort, id").bind(id)
  ]);

  event.prizes = results[0].results || [];
  event.tiers = results[1].results || [];
  event.poster_url = posterOf(event);
  event.group = eventGroup(event, taiwanToday());

  return jsonResponse({ success: true, data: event });

}


async function saveEvent(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  if (id !== null) {

    var current = await getEvent(env, id);

    if (!current) {
      return errorResponse("EVENT_NOT_FOUND", 404);
    }

    if (current.archived_at) {
      return archivedError();
    }
  }

  var eventType = EVENT_TYPES.indexOf(body.event_type) !== -1 ? body.event_type : "daily";
  var eventDate = cleanText(body.event_date);
  var title = cleanText(body.title);
  var startTime = cleanText(body.start_time);
  var note = cleanText(body.note).slice(0, 200);
  var isPublic = body.is_public === 0 || body.is_public === "0" || body.is_public === false ? 0 : 1;
  var fee = toInt(body.fee, 0, 100000);
  var capacity = toInt(body.capacity, 1, 9999);
  var deadline = cleanText(body.reg_deadline);
  var posterId = isPositiveInteger(body.poster_image_id) ? Number(body.poster_image_id) : null;

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

  if (Number.isNaN(fee)) {
    return errorResponse("INVALID_NUMBER", 400, { field: "fee" });
  }

  if (Number.isNaN(capacity)) {
    return errorResponse("INVALID_NUMBER", 400, { field: "capacity" });
  }

  if (deadline && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) {
    return errorResponse("INVALID_DATE", 400, { field: "reg_deadline" });
  }

  var prizes = cleanList(body.prizes, function (item) {

    var label = cleanText(item && item.rank_label).slice(0, 20);
    var prize = cleanText(item && item.prize).slice(0, 100);

    return label ? { rank_label: label, prize: prize || null } : null;
  });

  var tiers = [];

  if (Array.isArray(body.tiers)) {

    for (var i = 0; i < body.tiers.length && i < MAX_LIST_ITEMS; i++) {

      var tier = body.tiers[i] || {};
      var min = toInt(tier.min_players, 0, 999);
      var qty = toInt(tier.qty, 1, 999);

      if (Number.isNaN(min) || Number.isNaN(qty)) {
        return errorResponse("INVALID_NUMBER", 400, { field: "tiers" });
      }

      tiers.push({
        id: isPositiveInteger(tier.id) ? Number(tier.id) : null,
        min_players: min || 0,
        prize: cleanText(tier.prize).slice(0, 100) || null,
        qty: qty || 1
      });
    }
  }

  var big = eventType === "big";

  var values = [
    eventType,
    eventDate,
    title,
    startTime || null,
    isPublic,
    note || null,
    big ? fee : null,
    big ? capacity : null,
    big && deadline ? deadline : null,
    posterId,
    cleanLong(body.bonus_text) || null,
    cleanLong(body.rules_text) || null,
    cleanLong(body.special_text) || null,
    cleanLong(body.notes_text) || null
  ];

  if (id === null) {

    var created = await env.DB.prepare(
      "INSERT INTO checkin_events " +
      "(event_type, event_date, title, start_time, is_public, note, fee, capacity, reg_deadline, " +
      "poster_image_id, bonus_text, rules_text, special_text, notes_text) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(values[0], values[1], values[2], values[3], values[4], values[5], values[6],
      values[7], values[8], values[9], values[10], values[11], values[12], values[13])
    .run();

    id = created.meta.last_row_id;

  } else {

    await env.DB.prepare(
      "UPDATE checkin_events SET " +
      "event_type = ?, event_date = ?, title = ?, start_time = ?, is_public = ?, note = ?, fee = ?, " +
      "capacity = ?, reg_deadline = ?, poster_image_id = ?, bonus_text = ?, rules_text = ?, " +
      "special_text = ?, notes_text = ?, " +
      "poster_link = CASE WHEN ? = 1 THEN NULL ELSE poster_link END, " +
      "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .bind(values[0], values[1], values[2], values[3], values[4], values[5], values[6],
      values[7], values[8], values[9], values[10], values[11], values[12], values[13],
      body.poster_removed === true ? 1 : 0, id)
    .run();
  }

  /* 獎品：整批換掉。抽獎門檻：保留原本的 id（已經抽出的獎會連著門檻） */
  var statements = [
    env.DB.prepare("DELETE FROM checkin_event_prizes WHERE event_id = ?").bind(id)
  ];

  prizes.forEach(function (item, index) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO checkin_event_prizes (event_id, sort, rank_label, prize) VALUES (?, ?, ?, ?)"
      ).bind(id, index, item.rank_label, item.prize)
    );
  });

  var keepIds = tiers.filter(function (t) { return t.id; }).map(function (t) { return t.id; });

  statements.push(
    env.DB.prepare(
      "DELETE FROM checkin_lottery_tiers WHERE event_id = ? AND id NOT IN (SELECT value FROM json_each(?))"
    ).bind(id, JSON.stringify(keepIds))
  );

  statements.push(
    env.DB.prepare(
      "UPDATE checkin_lottery_wins SET tier_id = NULL WHERE event_id = ? AND tier_id IS NOT NULL " +
      "AND tier_id NOT IN (SELECT value FROM json_each(?))"
    ).bind(id, JSON.stringify(keepIds))
  );

  tiers.forEach(function (tier, index) {

    if (tier.id) {
      statements.push(
        env.DB.prepare(
          "UPDATE checkin_lottery_tiers SET sort = ?, min_players = ?, prize = ?, qty = ? WHERE id = ? AND event_id = ?"
        ).bind(index, tier.min_players, tier.prize, tier.qty, tier.id, id)
      );
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO checkin_lottery_tiers (event_id, sort, min_players, prize, qty) VALUES (?, ?, ?, ?, ?)"
        ).bind(id, index, tier.min_players, tier.prize, tier.qty)
      );
    }
  });

  await env.DB.batch(statements);

  await writeAuditLog(env, staff, "save", "checkin_events", id, { date: eventDate, title: title });

  return getEventDetail(env, id);

}


async function deleteEvent(env, staff, id) {

  if (MANAGER_ROLES.indexOf(staff.role) === -1) {
    return errorResponse("FORBIDDEN", 403);
  }

  var event = await getEvent(env, id);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  if (event.archived_at) {
    return archivedError();
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_lottery_tiers WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_event_prizes WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_results WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_entries WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_events WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "delete", "checkin_events", id, { date: event.event_date, title: event.title });

  return jsonResponse({ success: true });

}


async function endEvent(env, staff, id) {

  var check = await getOpenEvent(env, id);

  if (check.response) {
    return check.response;
  }

  await env.DB.prepare(
    "UPDATE checkin_events SET ended_at = COALESCE(ended_at, ?) WHERE id = ?"
  )
  .bind(taiwanNow(), id)
  .run();

  await writeAuditLog(env, staff, "end", "checkin_events", id, null);

  return jsonResponse({ success: true });

}


/* =========================================================
   賽後紀錄 / 封存
========================================================= */

async function settleData(env, event) {

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, nickname, checkin_number, is_judge, player_id FROM checkin_entries " +
      "WHERE event_id = ? AND checked_in = 1 ORDER BY checkin_number ASC, id ASC"
    ).bind(event.id),
    env.DB.prepare(
      "SELECT r.id, r.rank_label, r.entry_id, r.prize, c.nickname, c.checkin_number FROM checkin_results r " +
      "LEFT JOIN checkin_entries c ON c.id = r.entry_id WHERE r.event_id = ? ORDER BY r.sort, r.id"
    ).bind(event.id),
    env.DB.prepare(
      "SELECT w.id, w.prize, w.tier_id, c.nickname, c.checkin_number FROM checkin_lottery_wins w " +
      "INNER JOIN checkin_entries c ON c.id = w.entry_id WHERE w.event_id = ? ORDER BY w.id"
    ).bind(event.id),
    env.DB.prepare(
      "SELECT rank_label, prize FROM checkin_event_prizes WHERE event_id = ? ORDER BY sort, id"
    ).bind(event.id),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM checkin_entries WHERE event_id = ?"
    ).bind(event.id)
  ]);

  var checked = results[0].results || [];
  var fees = null;

  try {
    fees = event.settle_fees ? JSON.parse(event.settle_fees) : null;
  } catch (error) {
    fees = null;
  }

  if (!Array.isArray(fees)) {
    fees = [{ label: "原價", price: event.fee || 0, count: checked.length }];
  }

  var placements = results[1].results || [];
  var defaults = results[3].results || [];

  /* 還沒存過賽後紀錄：用場次的預設獎品排出空白名次 */
  if (!placements.length && !event.settled_at) {
    placements = defaults.map(function (item) {
      return { id: null, rank_label: item.rank_label, entry_id: null, prize: item.prize };
    });
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      event_date: event.event_date,
      start_time: event.start_time,
      event_type: event.event_type,
      fee: event.fee,
      archived_at: event.archived_at,
      settled_at: event.settled_at
    },
    total: ((results[4].results || [])[0] || {}).total || 0,
    checked: checked,
    linked: checked.filter(function (c) { return c.player_id; }).length,
    fees: fees,
    note: event.settle_note || "",
    placements: placements,
    wins: results[2].results || []
  };

}


async function getSettle(env, id) {

  var event = await getEvent(env, id);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  return jsonResponse({ success: true, data: await settleData(env, event) });

}


async function saveSettle(request, env, staff, id, archive) {

  var body = (await parseJsonBody(request)) || {};
  var check = await getOpenEvent(env, id);

  if (check.response) {
    return check.response;
  }

  var event = check.event;

  var fees = cleanList(body.fees, function (item) {

    var label = cleanText(item && item.label).slice(0, 20) || "優惠價";
    var price = toInt(item && item.price, 0, 100000);
    var count = toInt(item && item.count, 0, 9999);

    if (Number.isNaN(price) || Number.isNaN(count)) {
      return null;
    }

    return { label: label, price: price || 0, count: count || 0 };
  });

  var entryRows = await env.DB.prepare(
    "SELECT id, player_id FROM checkin_entries WHERE event_id = ? AND checked_in = 1"
  )
  .bind(id)
  .all();

  var checkedMap = {};

  (entryRows.results || []).forEach(function (row) {
    checkedMap[row.id] = row;
  });

  var placements = cleanList(body.placements, function (item) {

    var label = cleanText(item && item.rank_label).slice(0, 20);
    var entryId = isPositiveInteger(item && item.entry_id) ? Number(item.entry_id) : null;

    if (!label) {
      return null;
    }

    if (entryId && !checkedMap[entryId]) {
      entryId = null;
    }

    return { rank_label: label, entry_id: entryId, prize: cleanText(item && item.prize).slice(0, 100) || null };
  });

  var winPrizes = cleanList(body.wins, function (item) {
    return isPositiveInteger(item && item.id)
      ? { id: Number(item.id), prize: cleanText(item.prize).slice(0, 100) || null }
      : null;
  });

  var now = taiwanNow();

  var statements = [
    env.DB.prepare(
      "UPDATE checkin_events SET settle_fees = ?, settle_note = ?, settled_at = ?, " +
      "ended_at = COALESCE(ended_at, ?) WHERE id = ?"
    ).bind(JSON.stringify(fees), cleanLong(body.note) || null, now, now, id),
    env.DB.prepare("DELETE FROM checkin_results WHERE event_id = ?").bind(id)
  ];

  placements.forEach(function (item, index) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO checkin_results (event_id, sort, rank_label, entry_id, prize) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, index, item.rank_label, item.entry_id, item.prize)
    );
  });

  winPrizes.forEach(function (item) {
    statements.push(
      env.DB.prepare("UPDATE checkin_lottery_wins SET prize = ? WHERE id = ? AND event_id = ?")
        .bind(item.prize, item.id, id)
    );
  });

  await env.DB.batch(statements);

  if (archive) {

    var checkedCount = Object.keys(checkedMap).length;

    /* 有綁官網選手資料、名次是數字的上位者 → 寫進選手上位紀錄（排行榜） */
    var saved = await env.DB.prepare(
      "SELECT r.id, r.rank_label, c.player_id FROM checkin_results r " +
      "INNER JOIN checkin_entries c ON c.id = r.entry_id " +
      "WHERE r.event_id = ? AND c.player_id IS NOT NULL"
    )
    .bind(id)
    .all();

    var archiveStatements = [];

    (saved.results || []).forEach(function (row) {

      var rank = rankNumber(row.rank_label);

      if (!rank) {
        return;
      }

      archiveStatements.push(
        env.DB.prepare(
          "INSERT INTO player_placements (player_id, event_date, event_name, participant_count, placement) " +
          "VALUES (?, ?, ?, ?, ?)"
        ).bind(row.player_id, event.event_date, event.title, checkedCount, rank)
      );

      archiveStatements.push(
        env.DB.prepare("UPDATE checkin_results SET placement_id = last_insert_rowid() WHERE id = ?").bind(row.id)
      );
    });

    archiveStatements.push(
      env.DB.prepare(
        "UPDATE checkin_events SET archived_at = ?, archived_by = ? WHERE id = ? AND archived_at IS NULL"
      ).bind(now, String(staff.id), id)
    );

    await env.DB.batch(archiveStatements);

    await writeAuditLog(env, staff, "archive", "checkin_events", id, { checked: checkedCount });

  } else {

    await writeAuditLog(env, staff, "settle", "checkin_events", id, null);
  }

  return jsonResponse({ success: true, data: await settleData(env, await getEvent(env, id)) });

}


async function unarchive(env, staff, id) {

  if (staff.role !== "sysadmin") {
    return errorResponse("FORBIDDEN", 403);
  }

  var event = await getEvent(env, id);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  if (!event.archived_at) {
    return jsonResponse({ success: true });
  }

  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM player_placements WHERE id IN " +
      "(SELECT placement_id FROM checkin_results WHERE event_id = ? AND placement_id IS NOT NULL)"
    ).bind(id),
    env.DB.prepare("UPDATE checkin_results SET placement_id = NULL WHERE event_id = ?").bind(id),
    env.DB.prepare("UPDATE checkin_events SET archived_at = NULL, archived_by = NULL WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "unarchive", "checkin_events", id, null);

  return jsonResponse({ success: true });

}


/* =========================================================
   名單 / 報到
========================================================= */

var ENTRY_SELECT =
  "SELECT c.id, c.event_id, c.nickname, c.player_id, c.checked_in, c.checkin_number, " +
  "c.is_judge, c.checked_in_at, c.contact_phone, c.source, " +
  "CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS has_won " +
  "FROM checkin_entries c " +
  "LEFT JOIN (SELECT MIN(id) AS id, entry_id FROM checkin_lottery_wins GROUP BY entry_id) w ON w.entry_id = c.id ";


async function getEntry(env, id) {

  return env.DB.prepare(ENTRY_SELECT + "WHERE c.id = ?")
    .bind(id)
    .first();

}


async function listEntries(env, eventId) {

  var event = await getEvent(env, eventId);

  if (!event) {
    return errorResponse("EVENT_NOT_FOUND", 404);
  }

  var result = await env.DB.prepare(
    ENTRY_SELECT +
    "WHERE c.event_id = ? " +
    "ORDER BY c.checked_in DESC, c.checkin_number ASC, c.id ASC"
  )
  .bind(eventId)
  .all();

  return jsonResponse({
    success: true,
    event: { id: event.id, title: event.title, event_date: event.event_date, archived_at: event.archived_at },
    data: result.results || []
  });

}


async function addEntry(request, env, eventId) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var check = await getOpenEvent(env, eventId);

  if (check.response) {
    return check.response;
  }

  var nickname = cleanText(body.nickname);
  var playerId = isPositiveInteger(body.player_id) ? Number(body.player_id) : null;

  if (!nickname) {
    return errorResponse("REQUIRED", 400, { field: "nickname" });
  }

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
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


/*
  批次報到：items = [{ id, checked_in, checkin_number, is_judge }]
  號碼由前端依「已有沿用、其餘從上一位 +1」算好送來；這裡檢查後一次寫入。
*/
async function batchUpdate(request, env, staff, eventId) {

  var body = await parseJsonBody(request);

  if (!body || !Array.isArray(body.items) || !body.items.length) {
    return errorResponse("INVALID_JSON", 400);
  }

  if (body.items.length > 200) {
    return errorResponse("TOO_MANY_LINES", 400);
  }

  var check = await getOpenEvent(env, eventId);

  if (check.response) {
    return check.response;
  }

  var now = taiwanNow();
  var seen = {};
  var ids = [];
  var updates = [];

  for (var i = 0; i < body.items.length; i++) {

    var item = body.items[i] || {};

    if (!isPositiveInteger(item.id)) {
      return errorResponse("ENTRY_NOT_FOUND", 404);
    }

    var entryId = Number(item.id);
    var checked = Number(item.checked_in) === 1;
    var judge = checked && Number(item.is_judge) === 1 ? 1 : 0;
    var number = checked ? toInt(item.checkin_number, 1, 9999) : null;

    if (checked && (number === null || Number.isNaN(number))) {
      return errorResponse("INVALID_NUMBER", 400, { field: "checkin_number", entry_id: entryId });
    }

    if (number !== null) {

      if (seen[number]) {
        return errorResponse("DUPLICATE_NUMBER", 409, { field: "checkin_number", number: number });
      }

      seen[number] = true;
    }

    ids.push(entryId);

    updates.push(
      checked
        ? env.DB.prepare(
            "UPDATE checkin_entries SET checked_in = 1, is_judge = ?, checkin_number = ?, " +
            "checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ? AND event_id = ?"
          ).bind(judge, number, now, entryId, eventId)
        : env.DB.prepare(
            "UPDATE checkin_entries SET checked_in = 0, is_judge = 0, checkin_number = NULL, " +
            "checked_in_at = NULL WHERE id = ? AND event_id = ?"
          ).bind(entryId, eventId)
    );
  }

  /* 先把這批人的號碼清空，互換號碼時才不會撞到唯一索引 */
  var statements = [
    env.DB.prepare(
      "UPDATE checkin_entries SET checkin_number = NULL WHERE event_id = ? AND id IN (SELECT value FROM json_each(?))"
    ).bind(eventId, JSON.stringify(ids))
  ].concat(updates);

  try {
    await env.DB.batch(statements);
  } catch (error) {

    var unique = uniqueError(error);

    if (unique) {
      return unique;
    }

    throw error;
  }

  await writeAuditLog(env, staff, "checkin", "checkin_events", eventId, { count: ids.length });

  return listEntries(env, eventId);

}


async function importEntries(request, env, staff, eventId) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var check = await getOpenEvent(env, eventId);

  if (check.response) {
    return check.response;
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

  return jsonResponse({ success: true, imported: imported, duplicates: duplicates, invalid: invalid });

}


async function deleteEntry(env, staff, id) {

  var event = await getEntryEvent(env, id);

  if (!event) {
    return errorResponse("ENTRY_NOT_FOUND", 404);
  }

  if (event.archived_at) {
    return archivedError();
  }

  var entry = await getEntry(env, id);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE entry_id = ?").bind(id),
    env.DB.prepare("UPDATE checkin_results SET entry_id = NULL WHERE entry_id = ?").bind(id),
    env.DB.prepare("DELETE FROM checkin_entries WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "delete", "checkin_entries", id, {
    event_id: event.id,
    nickname: entry && entry.nickname
  });

  return jsonResponse({ success: true });

}


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
   抽獎（多個門檻）
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
      "SELECT w.id, w.prize, w.tier_id, w.drawn_at, c.id AS entry_id, c.nickname, c.checkin_number, c.is_judge " +
      "FROM checkin_lottery_wins w INNER JOIN checkin_entries c ON w.entry_id = c.id " +
      "WHERE w.event_id = ? ORDER BY w.id DESC"
    ).bind(event.id),

    env.DB.prepare(
      "SELECT t.id, t.min_players, t.prize, t.qty, " +
      "(SELECT COUNT(*) FROM checkin_lottery_wins w WHERE w.tier_id = t.id) AS drawn " +
      "FROM checkin_lottery_tiers t WHERE t.event_id = ? ORDER BY t.sort, t.id"
    ).bind(event.id)

  ]);

  var counts = (results[0].results || [])[0] || {};

  return {
    event_id: event.id,
    archived: !!event.archived_at,
    checked_count: Number(counts.checked_count) || 0,
    eligible_count: Number(counts.eligible_count) || 0,
    tiers: results[2].results || [],
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
  var check = await getOpenEvent(env, eventId);

  if (check.response) {
    return check.response;
  }

  var event = check.event;
  var before = await lotteryData(env, event);
  var tier = null;

  if (isPositiveInteger(body.tier_id)) {

    before.tiers.forEach(function (item) {
      if (item.id === Number(body.tier_id)) {
        tier = item;
      }
    });

    if (!tier) {
      return errorResponse("TIER_NOT_FOUND", 404, { data: before });
    }
  }

  var prize = tier ? tier.prize : (cleanText(body.prize).slice(0, 100) || null);

  if (tier && tier.min_players > 0 && before.checked_count < tier.min_players && body.confirm_below_threshold !== true) {
    return errorResponse("BELOW_THRESHOLD", 409, { data: before, threshold: tier.min_players });
  }

  if (tier && tier.drawn >= tier.qty && body.confirm_over_quota !== true) {
    return errorResponse("TIER_FULL", 409, { data: before });
  }

  if (!before.eligible_count) {
    return errorResponse("NO_ELIGIBLE", 409, { data: before });
  }

  var result = await env.DB.prepare(
    "INSERT INTO checkin_lottery_wins (event_id, entry_id, prize, drawn_by, tier_id) " +
    "SELECT ?, c.id, ?, ?, ? FROM checkin_entries c " +
    "WHERE c.event_id = ? AND c.checked_in = 1 " +
    "AND NOT EXISTS (SELECT 1 FROM checkin_lottery_wins w WHERE w.event_id = c.event_id AND w.entry_id = c.id) " +
    "ORDER BY RANDOM() LIMIT 1"
  )
  .bind(eventId, prize, String(staff.id), tier ? tier.id : null, eventId)
  .run();

  if (!result.meta.changes) {
    return errorResponse("NO_ELIGIBLE", 409, { data: await lotteryData(env, event) });
  }

  var winner = await env.DB.prepare(
    "SELECT w.id, w.prize, w.tier_id, w.drawn_at, c.id AS entry_id, c.nickname, c.checkin_number, c.is_judge " +
    "FROM checkin_lottery_wins w INNER JOIN checkin_entries c ON w.entry_id = c.id WHERE w.id = ?"
  )
  .bind(result.meta.last_row_id)
  .first();

  await writeAuditLog(env, staff, "lottery", "checkin_events", eventId, {
    nickname: winner && winner.nickname,
    prize: prize
  });

  return jsonResponse({ success: true, winner: winner, data: await lotteryData(env, event) });

}


async function deleteWin(env, staff, id) {

  var win = await env.DB.prepare(
    "SELECT w.*, e.archived_at FROM checkin_lottery_wins w " +
    "INNER JOIN checkin_events e ON e.id = w.event_id WHERE w.id = ?"
  )
  .bind(id)
  .first();

  if (!win) {
    return errorResponse("WIN_NOT_FOUND", 404);
  }

  if (win.archived_at) {
    return archivedError();
  }

  await env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE id = ?").bind(id).run();

  await writeAuditLog(env, staff, "lottery_undo", "checkin_lottery_wins", id, { entry_id: win.entry_id });

  return jsonResponse({ success: true });

}


/* =========================================================
   網站設定 / 圖片
========================================================= */

async function getSite(env) {

  var data = {
    store: await getSetting(env, "store", { hours: [], address: "", map_url: "" }),
    socials: await getSetting(env, "socials", { line_official: "", line_group: "", instagram: "" }),
    about: await getSetting(env, "about", { text: "", image_id: null }),
    presets: await getSetting(env, "presets", { bonus: [], rules: [], special: [], notes: [] })
  };

  data.about.image_url = imageUrl(data.about.image_id);

  return jsonResponse({ success: true, data: data });

}


function cleanUrl(value) {

  var text = cleanText(value).slice(0, 500);

  return /^https:\/\/[^\s<>"']+$/.test(text) ? text : "";

}


async function saveSite(request, env, staff) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var store = body.store || {};
  var socials = body.socials || {};
  var about = body.about || {};
  var presets = body.presets || {};

  var cleanStore = {
    hours: cleanList(store.hours, function (row) {
      var day = cleanText(row && row.day).slice(0, 30);
      var time = cleanText(row && row.time).slice(0, 40);
      return day || time ? { day: day, time: time } : null;
    }),
    address: cleanText(store.address).slice(0, 120),
    map_url: cleanUrl(store.map_url)
  };

  var cleanSocials = {
    line_official: cleanUrl(socials.line_official),
    line_group: cleanUrl(socials.line_group),
    instagram: cleanUrl(socials.instagram)
  };

  var cleanAbout = {
    text: cleanLong(about.text),
    image_id: isPositiveInteger(about.image_id) ? Number(about.image_id) : null
  };

  var cleanPresets = {};

  PRESET_KEYS.forEach(function (key) {
    cleanPresets[key] = cleanList(presets[key], function (text) {
      text = cleanText(text).slice(0, 200);
      return text || null;
    });
  });

  var statement = env.DB.prepare(
    "INSERT INTO site_settings (setting_key, setting_value, updated_at, updated_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?) " +
    "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, " +
    "updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by"
  );

  var by = String(staff.id);

  await env.DB.batch([
    statement.bind("store", JSON.stringify(cleanStore), by),
    statement.bind("socials", JSON.stringify(cleanSocials), by),
    statement.bind("about", JSON.stringify(cleanAbout), by),
    statement.bind("presets", JSON.stringify(cleanPresets), by)
  ]);

  await writeAuditLog(env, staff, "save", "site_settings", null, null);

  return getSite(env);

}


async function uploadImage(request, env, staff) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var mime = cleanText(body.mime);
  var data = String(body.data || "");

  if (["image/jpeg", "image/png", "image/webp"].indexOf(mime) === -1) {
    return errorResponse("INVALID_IMAGE", 400);
  }

  if (!data || data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
    return errorResponse("IMAGE_TOO_LARGE", 400);
  }

  var result = await env.DB.prepare(
    "INSERT INTO site_images (mime, data, created_by) VALUES (?, ?, ?)"
  )
  .bind(mime, data, String(staff.id))
  .run();

  var id = result.meta.last_row_id;

  return jsonResponse({ success: true, data: { id: id, url: imageUrl(id) } }, 201);

}


/* =========================================================
   官網：恭喜上位 / 線上報名
========================================================= */

async function publicHighlights(env) {

  var result = await env.DB.prepare(
    "SELECT r.rank_label, c.nickname, e.title, e.event_date, t.team_name " +
    "FROM checkin_results r " +
    "INNER JOIN checkin_events e ON e.id = r.event_id " +
    "INNER JOIN checkin_entries c ON c.id = r.entry_id " +
    "LEFT JOIN players p ON p.id = c.player_id " +
    "LEFT JOIN teams t ON t.id = p.team_id " +
    "WHERE e.archived_at IS NOT NULL AND e.is_public = 1 " +
    "ORDER BY e.event_date DESC, e.id DESC, r.sort ASC, r.id ASC " +
    "LIMIT 6"
  ).all();

  return jsonResponse({ success: true, data: result.results || [] }, 200, API_CACHE_SECONDS);

}


async function publicRegister(request, env) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  /* ---------- 名單 ---------- */

  var names = [];
  var seen = {};
  var rawNames = Array.isArray(body.names) ? body.names : [];

  for (var i = 0; i < rawNames.length; i++) {

    var name = cleanText(rawNames[i]);

    if (!name) {
      continue;
    }

    if (!validName(name)) {
      return errorResponse("INVALID_NAME", 400, { field: "names", value: name.slice(0, 30) });
    }

    var key = name.toLowerCase();

    if (!seen[key]) {
      seen[key] = true;
      names.push(name);
    }
  }

  if (!names.length) {
    return errorResponse("REQUIRED", 400, { field: "names" });
  }

  if (names.length > SIGNUP_MAX_NAMES) {
    return errorResponse("TOO_MANY_NAMES", 400);
  }

  var phone = cleanText(body.phone);

  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
    return errorResponse("INVALID_PHONE", 400, { field: "phone" });
  }

  var eventIds = [];

  (Array.isArray(body.event_ids) ? body.event_ids : []).forEach(function (id) {
    if (isPositiveInteger(id) && eventIds.indexOf(Number(id)) === -1) {
      eventIds.push(Number(id));
    }
  });

  if (!eventIds.length) {
    return errorResponse("REQUIRED", 400, { field: "event_ids" });
  }

  if (eventIds.length > SIGNUP_MAX_EVENTS) {
    return errorResponse("TOO_MANY_EVENTS", 400);
  }

  /* ---------- 同一個網路連線短時間內的次數限制 ---------- */

  var ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  var ipHash = await sha256Hex("ourspace-signup:" + ip);

  var recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signup_attempts WHERE ip_hash = ? AND created_at > datetime('now', ?)"
  )
  .bind(ipHash, "-" + SIGNUP_WINDOW_MINUTES + " minutes")
  .first();

  if (recent && Number(recent.n) >= SIGNUP_MAX_PER_WINDOW) {
    return errorResponse("RATE_LIMITED", 429);
  }

  await env.DB.batch([
    env.DB.prepare("INSERT INTO signup_attempts (ip_hash) VALUES (?)").bind(ipHash),
    env.DB.prepare("DELETE FROM signup_attempts WHERE created_at < datetime('now', '-1 day')")
  ]);

  /* ---------- 檢查每一場 ---------- */

  var today = taiwanToday();
  var now = taiwanNow();
  var events = [];

  for (var j = 0; j < eventIds.length; j++) {

    var event = await env.DB.prepare(
      "SELECT e.id, e.title, e.event_type, e.event_date, e.is_public, e.archived_at, e.capacity, e.reg_deadline, " +
      "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id) AS total " +
      "FROM checkin_events e WHERE e.id = ?"
    )
    .bind(eventIds[j])
    .first();

    if (!event || Number(event.is_public) !== 1 || event.event_type !== "big" || event.archived_at || event.event_date < today) {
      return errorResponse("SIGNUP_CLOSED", 409, { event_id: eventIds[j], title: event ? event.title : null });
    }

    if (event.reg_deadline && event.reg_deadline.replace("T", " ") < now) {
      return errorResponse("SIGNUP_CLOSED", 409, { event_id: event.id, title: event.title });
    }

    if (event.capacity && Number(event.total) + names.length > Number(event.capacity)) {
      return errorResponse("EVENT_FULL", 409, {
        event_id: event.id,
        title: event.title,
        left: Math.max(0, Number(event.capacity) - Number(event.total))
      });
    }

    events.push(event);
  }

  /* ---------- 寫入（同一場已經有相同名稱就略過） ---------- */

  var statement = env.DB.prepare(
    "INSERT OR IGNORE INTO checkin_entries (event_id, nickname, contact_phone, source, registered_at) " +
    "VALUES (?, ?, ?, 'online', ?)"
  );

  var statements = [];

  events.forEach(function (event) {
    names.forEach(function (name) {
      statements.push(statement.bind(event.id, name, phone || null, now));
    });
  });

  var results = await env.DB.batch(statements);
  var summary = [];
  var k = 0;

  events.forEach(function (event) {

    var added = 0;

    names.forEach(function () {
      added += results[k].meta.changes || 0;
      k++;
    });

    summary.push({
      event_id: event.id,
      title: event.title,
      added: added,
      duplicates: names.length - added
    });
  });

  return jsonResponse({ success: true, data: summary }, 201);

}
