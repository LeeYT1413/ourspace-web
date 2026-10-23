/* =========================================================
   OURSPACE
   官網浮動廣告

   官網
     GET  /api/ads/current            今天要顯示的廣告（多則時依權重隨機挑一則）
     POST /api/ads/event              { ad_id, type: view | close | click }

   後台（頁面權限 ads）
     GET    /api/referee/ads?days=30  廣告列表 + 成效（觀看、關閉率、點擊率）
     POST   /api/referee/ads          新增
     PUT    /api/referee/ads/:id      修改
     DELETE /api/referee/ads/:id      刪除（統計一起刪）
     POST   /api/referee/ads/images   上傳廣告圖片
     GET/PUT /api/referee/ads/config  顯示方式：refresh（每次重新整理都顯示）
                                      或 24h（關掉一次就 24 小時不再出現）
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanToday
} from "./util.js";

import { requireStaff, writeAuditLog } from "./auth.js";


var EVENT_TYPES = { view: "views", close: "closes", click: "clicks" };
var MAX_IMAGE_CHARS = 1400000;


function imageUrl(id) {
  return id ? "/api/checkin/images/" + id : null;
}


function cleanUrl(value) {
  var text = cleanText(value).slice(0, 500);
  return /^https:\/\/[^\s<>"']+$/.test(text) ? text : "";
}


function cleanDate(value) {
  var text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}


export async function handleAdsApi(request, url, env) {

  var parts = url.pathname.split("/").filter(Boolean);

  if (parts[1] === "ads") {
    return handlePublic(request, parts.slice(2), env);
  }

  if (parts[1] === "referee" && parts[2] === "ads") {
    return handleStaff(request, url, parts.slice(3), env);
  }

  return null;
}


/* =========================================================
   官網
========================================================= */

async function handlePublic(request, parts, env) {

  if (parts[0] === "current" && request.method === "GET") {

    var today = taiwanToday();

    var result = await env.DB.prepare(
      "SELECT id, title, image_id, link_url, weight FROM ads " +
      "WHERE is_active = 1 AND image_id IS NOT NULL " +
      "AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)"
    )
    .bind(today, today)
    .all();

    var list = result.results || [];

    var closeMode = await getCloseMode(env);

    if (!list.length) {
      return jsonResponse({ success: true, data: null, close_mode: closeMode }, 200, 60);
    }

    /* 依權重隨機挑一則 */
    var total = list.reduce(function (sum, ad) { return sum + Math.max(1, ad.weight || 1); }, 0);
    var pick = Math.random() * total;
    var chosen = list[0];

    for (var i = 0; i < list.length; i++) {
      pick -= Math.max(1, list[i].weight || 1);
      if (pick < 0) {
        chosen = list[i];
        break;
      }
    }

    return jsonResponse({
      success: true,
      close_mode: closeMode,
      data: { id: chosen.id, title: chosen.title, image_url: imageUrl(chosen.image_id), link_url: chosen.link_url || null }
    }, 200, 0);
  }

  if (parts[0] === "event" && request.method === "POST") {

    var body = (await parseJsonBody(request)) || {};
    var column = EVENT_TYPES[body.type];

    if (!column || !isPositiveInteger(body.ad_id)) {
      return errorResponse("INVALID_EVENT", 400);
    }

    var exists = await env.DB.prepare("SELECT id FROM ads WHERE id = ?").bind(Number(body.ad_id)).first();

    if (!exists) {
      return errorResponse("NOT_FOUND", 404);
    }

    await env.DB.prepare(
      "INSERT INTO ad_stats (ad_id, stat_date, " + column + ") VALUES (?, ?, 1) " +
      "ON CONFLICT(ad_id, stat_date) DO UPDATE SET " + column + " = " + column + " + 1"
    )
    .bind(Number(body.ad_id), taiwanToday())
    .run();

    return jsonResponse({ success: true });
  }

  return null;
}


/* =========================================================
   後台
========================================================= */

async function handleStaff(request, url, parts, env) {

  var auth = await requireStaff(request, env, ["ads"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;

  if (!parts.length && method === "GET") {
    return listAds(url, env);
  }

  if (!parts.length && method === "POST") {
    return saveAd(request, env, staff, null);
  }

  if (parts[0] === "images" && parts.length === 1 && method === "POST") {
    return uploadImage(request, env, staff);
  }

  if (parts[0] === "config" && parts.length === 1 && method === "GET") {
    return jsonResponse({ success: true, close_mode: await getCloseMode(env) });
  }

  if (parts[0] === "config" && parts.length === 1 && method === "PUT") {

    var body = (await parseJsonBody(request)) || {};
    var mode = body.close_mode === "24h" ? "24h" : "refresh";

    await env.DB.prepare(
      "INSERT INTO site_settings (setting_key, setting_value, updated_by) VALUES ('ads_config', ?, ?) " +
      "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, " +
      "updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by"
    )
    .bind(JSON.stringify({ close_mode: mode }), String(staff.id))
    .run();

    await writeAuditLog(env, staff, "save", "ads_config", null, { close_mode: mode });

    return jsonResponse({ success: true, close_mode: mode });
  }

  if (isPositiveInteger(parts[0]) && parts.length === 1) {

    if (method === "PUT") {
      return saveAd(request, env, staff, Number(parts[0]));
    }

    if (method === "DELETE") {
      return deleteAd(env, staff, Number(parts[0]));
    }
  }

  return null;
}


async function listAds(url, env) {

  var days = Number(url.searchParams.get("days"));

  if ([7, 30, 90].indexOf(days) === -1) {
    days = 0; /* 0 = 全部期間 */
  }

  var since = days ? "date(?, '-" + (days - 1) + " days')" : "'0000-00-00'";

  var statement = env.DB.prepare(
    "SELECT a.*, " +
    "COALESCE(SUM(s.views), 0) AS views, COALESCE(SUM(s.closes), 0) AS closes, COALESCE(SUM(s.clicks), 0) AS clicks " +
    "FROM ads a LEFT JOIN ad_stats s ON s.ad_id = a.id AND s.stat_date >= " + since + " " +
    "GROUP BY a.id ORDER BY a.is_active DESC, a.id DESC"
  );

  var result = await (days ? statement.bind(taiwanToday()) : statement).all();
  var today = taiwanToday();

  var rows = (result.results || []).map(function (ad) {

    ad.image_url = imageUrl(ad.image_id);
    ad.close_rate = ad.views ? Math.round(ad.closes / ad.views * 1000) / 10 : 0;
    ad.click_rate = ad.views ? Math.round(ad.clicks / ad.views * 1000) / 10 : 0;

    /* 目前狀態 */
    if (Number(ad.is_active) !== 1) {
      ad.state = "off";
    } else if (ad.start_date && ad.start_date > today) {
      ad.state = "scheduled";
    } else if (ad.end_date && ad.end_date < today) {
      ad.state = "ended";
    } else {
      ad.state = "on";
    }

    return ad;
  });

  return jsonResponse({ success: true, days: days, data: rows });
}


async function saveAd(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var title = cleanText(body.title).slice(0, 60);
  var link = cleanText(body.link_url) ? cleanUrl(body.link_url) : "";
  var start = cleanDate(body.start_date);
  var end = cleanDate(body.end_date);
  var weight = Number(body.weight);
  var imageId = isPositiveInteger(body.image_id) ? Number(body.image_id) : null;

  if (!title) {
    return errorResponse("REQUIRED", 400, { field: "title" });
  }

  if (cleanText(body.link_url) && !link) {
    return errorResponse("INVALID_URL", 400, { field: "link_url" });
  }

  if (start && end && end < start) {
    return errorResponse("INVALID_DATE", 400, { field: "end_date" });
  }

  if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    weight = 1;
  }

  var active = body.is_active === 0 || body.is_active === false ? 0 : 1;

  if (id === null) {

    var created = await env.DB.prepare(
      "INSERT INTO ads (title, image_id, link_url, is_active, start_date, end_date, weight) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(title, imageId, link || null, active, start, end, weight)
    .run();

    id = created.meta.last_row_id;

  } else {

    await env.DB.prepare(
      "UPDATE ads SET title = ?, image_id = ?, link_url = ?, is_active = ?, start_date = ?, end_date = ?, weight = ?, " +
      "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .bind(title, imageId, link || null, active, start, end, weight, id)
    .run();
  }

  await writeAuditLog(env, staff, "save", "ads", id, { title: title });

  return jsonResponse({ success: true, id: id });
}


async function deleteAd(env, staff, id) {

  await env.DB.batch([
    env.DB.prepare("DELETE FROM ad_stats WHERE ad_id = ?").bind(id),
    env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id)
  ]);

  await writeAuditLog(env, staff, "delete", "ads", id, null);

  return jsonResponse({ success: true });
}


async function uploadImage(request, env, staff) {

  var body = await parseJsonBody(request);
  var data = String((body && body.data) || "");

  if (!body || body.mime !== "image/jpeg" && body.mime !== "image/png" || !data ||
      data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
    return errorResponse("IMAGE_TOO_LARGE", 400);
  }

  var result = await env.DB.prepare("INSERT INTO site_images (mime, data, created_by) VALUES (?, ?, ?)")
    .bind(body.mime, data, String(staff.id))
    .run();

  return jsonResponse({ success: true, data: { id: result.meta.last_row_id, url: imageUrl(result.meta.last_row_id) } }, 201);
}



async function getCloseMode(env) {

  var row = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'ads_config'").first();

  try {
    return row && JSON.parse(row.setting_value).close_mode === "24h" ? "24h" : "refresh";
  } catch (error) {
    return "refresh";
  }
}
