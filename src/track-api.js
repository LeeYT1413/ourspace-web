/* =========================================================
   OURSPACE
   官網瀏覽量紀錄（寫到 ERP 資料庫，在 ERP 看報表）

     POST /api/track   { page, member: 0|1, vid }

   - 每天、每頁累計瀏覽次數，會員／非會員分開
   - 每天的不重複訪客（瀏覽器自己產生的隨機代碼，不含個資）
   - 搜尋引擎、預覽機器人不計
   - 寫入失敗不影響瀏覽
========================================================= */

import { jsonResponse, parseJsonBody, taiwanToday } from "./util.js";


var PAGES = [
  "home", "events", "roster", "ranking", "teams", "news", "about", "league",
  "brackets", "bracket-new", "bracket-edit", "b", "me", "join"
];

var BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|line-poker|whatsapp|headless/i;


export async function handleTrackApi(request, env) {

  if (request.method !== "POST" || !env.ERP_DB) {
    return jsonResponse({ success: true });
  }

  if (BOT.test(request.headers.get("User-Agent") || "")) {
    return jsonResponse({ success: true });
  }

  var body = (await parseJsonBody(request)) || {};
  var page = PAGES.indexOf(body.page) !== -1 ? body.page : "other";
  var member = body.member === 1 || body.member === true;
  var vid = /^[a-z0-9]{12,40}$/i.test(String(body.vid || "")) ? String(body.vid) : null;
  var today = taiwanToday();
  var column = member ? "member_views" : "guest_views";

  try {

    var statements = [
      env.ERP_DB.prepare(
        "INSERT INTO Web_page_views (stat_date, page, " + column + ") VALUES (?, ?, 1) " +
        "ON CONFLICT(stat_date, page) DO UPDATE SET " + column + " = " + column + " + 1"
      ).bind(today, page)
    ];

    if (vid) {
      statements.push(env.ERP_DB.prepare(
        "INSERT INTO Web_visitors (stat_date, visitor_id, is_member) VALUES (?, ?, ?) " +
        "ON CONFLICT(stat_date, visitor_id) DO UPDATE SET is_member = MAX(is_member, excluded.is_member)"
      ).bind(today, vid, member ? 1 : 0));
    }

    await env.ERP_DB.batch(statements);

  } catch (error) {
    console.error("track failed:", error);
  }

  return jsonResponse({ success: true });
}
