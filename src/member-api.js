/* =========================================================
   OURSPACE
   會員系統 API（/api/member/*）

   LINE 登入
     GET  /api/member/line/login?return=#me     轉到 LINE 登入
     GET  /api/member/line/callback             LINE 登入回來

   會員
     GET  /api/member/me                        目前登入的會員（沒登入回 null）
     PUT  /api/member/profile                   暱稱、電話、主要戰隊
     POST /api/member/logout
     GET  /api/member/search?q=                 找會員（幫別人報名）
     POST /api/member/register                  報名（自己、幫會員、直接輸入名字）
     GET  /api/member/signups                   我報的名（含幫別人報的）
     DELETE /api/member/signups/:entryId        報到前取消
     GET  /api/member/history                   參賽紀錄（有報到、已封存）
     GET  /api/member/placements                上位紀錄 + 認領狀態
     GET  /api/member/players?q=                找可認領的選手資料
     POST /api/member/claims                    認領選手資料
     DELETE /api/member/claims/:id              取消認領申請
     GET  /api/member/teams                     我的戰隊、可加入的戰隊、隊長管理資料
     POST /api/member/teams/:id/join            申請加入
     POST /api/member/teams/:id/leave           退出
     POST /api/member/teams/:id/primary         設為主要戰隊
     POST /api/member/teams/:id/members/:uid/approve   隊長核准
     POST /api/member/teams/:id/members/:uid/remove    隊長婉拒 / 移除
     POST /api/member/teams/:id/edit            隊長提交介紹 / 隊徽修改
     POST /api/member/images                    隊長上傳隊徽

   Cloudflare 設定：LINE_CHANNEL_ID（Text）、LINE_CHANNEL_SECRET（Secret）
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow,
  taiwanToday
} from "./util.js";


var MEMBER_COOKIE = "os_member";
var STATE_COOKIE = "os_line_state";
var SESSION_DAYS = 30;
var MAX_NAME_LENGTH = 50;
var MAX_IMAGE_CHARS = 700000;

var SIGNUP_WINDOW_MINUTES = 10;
var SIGNUP_MAX_PER_WINDOW = 6;
var SIGNUP_MAX_NAMES = 10;
var SIGNUP_MAX_EVENTS = 10;


/* =========================================================
   共用
========================================================= */

var encoder = new TextEncoder();

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function randomHex(bytes) {
  var data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return toHex(data);
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(String(text))));
}

function getCookie(request, name) {

  var parts = (request.headers.get("Cookie") || "").split(";");

  for (var i = 0; i < parts.length; i++) {
    var pair = parts[i].trim();
    var index = pair.indexOf("=");
    if (index > 0 && pair.slice(0, index) === name) {
      return decodeURIComponent(pair.slice(index + 1));
    }
  }

  return "";
}

function cookie(name, value, maxAge, path) {
  return name + "=" + encodeURIComponent(value) + "; Path=" + (path || "/") +
    "; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

function redirect(location, cookies) {

  var headers = new Headers({ Location: location, "Cache-Control": "no-store" });

  (cookies || []).forEach(function (value) {
    headers.append("Set-Cookie", value);
  });

  return new Response(null, { status: 302, headers: headers });
}

export function validName(name) {
  return !!name && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f<>]/.test(name);
}

function validPhone(phone) {
  return /^[0-9+\-\s()]{8,20}$/.test(phone);
}

function phoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function maskPhone(phone) {
  var digits = phoneDigits(phone);
  return digits ? "末三碼 " + digits.slice(-3) : "";
}

function imageUrl(id) {
  return id ? "/api/checkin/images/" + id : null;
}


/* =========================================================
   登入狀態
========================================================= */

export async function getMember(request, env) {

  var token = getCookie(request, MEMBER_COOKIE);

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  var row = await env.DB.prepare(
    "SELECT u.id, u.line_user_id, u.display_name, u.avatar_url, u.nickname, u.line_name, u.phone, " +
    "u.primary_team_id, u.status, u.joined_at, t.team_name AS primary_team_name " +
    "FROM member_sessions s INNER JOIN users u ON u.id = s.user_id " +
    "LEFT JOIN teams t ON t.id = u.primary_team_id " +
    "WHERE s.token_hash = ? AND s.expires_at > datetime('now')"
  )
  .bind(await sha256Hex(token))
  .first();

  if (!row || row.status !== "active") {
    return null;
  }

  return row;
}


function publicMember(member) {

  if (!member) {
    return null;
  }

  return {
    id: member.id,
    nickname: member.nickname,
    line_name: member.line_name || member.display_name,
    avatar_url: member.avatar_url,
    phone: member.phone,
    primary_team_id: member.primary_team_id,
    primary_team_name: member.primary_team_name,
    joined_at: member.joined_at,
    needs_profile: !member.nickname || !member.phone
  };
}


/* =========================================================
   ERP 同步（失敗不影響官網）
========================================================= */

export async function syncMemberToErp(env, userId) {

  if (!env.ERP_DB) {
    return;
  }

  try {

    var user = await env.DB.prepare(
      "SELECT u.id, u.nickname, u.display_name, u.line_name, u.phone, u.status, u.joined_at, t.team_name " +
      "FROM users u LEFT JOIN teams t ON t.id = u.primary_team_id WHERE u.id = ?"
    )
    .bind(userId)
    .first();

    if (!user || !user.nickname) {
      return;
    }

    await env.ERP_DB.prepare(
      "INSERT INTO Members (member_id, web_user_id, nickname, phone, line_name, primary_team, status, joined_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours')) " +
      "ON CONFLICT(web_user_id) DO UPDATE SET nickname = excluded.nickname, phone = excluded.phone, " +
      "line_name = excluded.line_name, primary_team = excluded.primary_team, status = excluded.status, " +
      "updated_at = excluded.updated_at"
    )
    .bind("W" + user.id, user.id, user.nickname, user.phone || null, user.line_name || user.display_name,
      user.team_name || null, user.status, user.joined_at || null)
    .run();

  } catch (error) {
    console.error("ERP member sync failed:", error);
  }
}


/* 場次封存：有報到的會員寫進 ERP 會員參賽紀錄；解除封存：撤回 */
export async function syncEventToErp(env, eventId, archived) {

  if (!env.ERP_DB) {
    return;
  }

  try {

    if (!archived) {
      await env.ERP_DB.prepare("DELETE FROM Member_events WHERE web_event_id = ?").bind(eventId).run();
      return;
    }

    var event = await env.DB.prepare("SELECT id, event_date, title, event_type FROM checkin_events WHERE id = ?")
      .bind(eventId)
      .first();

    var rows = await env.DB.prepare(
      "SELECT c.user_id, c.checkin_number, " +
      "(SELECT r.rank_label FROM checkin_results r WHERE r.entry_id = c.id ORDER BY r.sort LIMIT 1) AS rank_label " +
      "FROM checkin_entries c WHERE c.event_id = ? AND c.checked_in = 1 AND c.user_id IS NOT NULL"
    )
    .bind(eventId)
    .all();

    var list = rows.results || [];

    if (!event || !list.length) {
      return;
    }

    var statement = env.ERP_DB.prepare(
      "INSERT INTO Member_events (member_id, web_event_id, event_date, event_title, event_type, checkin_number, rank_label) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(member_id, web_event_id) DO UPDATE SET checkin_number = excluded.checkin_number, " +
      "rank_label = excluded.rank_label, event_title = excluded.event_title"
    );

    await env.ERP_DB.batch(list.map(function (row) {
      return statement.bind("W" + row.user_id, event.id, event.event_date, event.title, event.event_type,
        row.checkin_number, row.rank_label || null);
    }));

  } catch (error) {
    console.error("ERP event sync failed:", error);
  }
}


/* =========================================================
   報名（官網共用：非會員 / 會員）
   people = [{ nickname, user_id?, player_id?, phone? }]
========================================================= */

export async function registerPeople(request, env, eventIds, people, registeredBy) {

  /* 同一個網路連線短時間內的次數限制 */
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

    if (event.capacity && Number(event.total) + people.length > Number(event.capacity)) {
      return errorResponse("EVENT_FULL", 409, {
        event_id: event.id,
        title: event.title,
        left: Math.max(0, Number(event.capacity) - Number(event.total))
      });
    }

    events.push(event);
  }

  var statement = env.DB.prepare(
    "INSERT OR IGNORE INTO checkin_entries " +
    "(event_id, nickname, user_id, player_id, contact_phone, source, registered_at, registered_by) " +
    "VALUES (?, ?, ?, ?, ?, 'online', ?, ?)"
  );

  var statements = [];

  events.forEach(function (event) {
    people.forEach(function (person) {
      statements.push(statement.bind(
        event.id,
        person.nickname,
        person.user_id || null,
        person.player_id || null,
        person.phone || null,
        now,
        registeredBy || null
      ));
    });
  });

  var results = await env.DB.batch(statements);
  var summary = [];
  var k = 0;

  events.forEach(function (event) {

    var added = 0;

    people.forEach(function () {
      added += results[k].meta.changes || 0;
      k++;
    });

    summary.push({ event_id: event.id, title: event.title, added: added, duplicates: people.length - added });
  });

  return jsonResponse({ success: true, data: summary }, 201);
}


export function cleanEventIds(list) {

  var ids = [];

  (Array.isArray(list) ? list : []).forEach(function (id) {
    if (isPositiveInteger(id) && ids.indexOf(Number(id)) === -1) {
      ids.push(Number(id));
    }
  });

  return ids;
}


/* 會員報名時帶入的選手資料：主要戰隊的那一筆優先 */
async function memberPlayerId(env, userId, primaryTeamId) {

  var row = await env.DB.prepare(
    "SELECT id FROM players WHERE user_id = ? AND status = 'active' " +
    "ORDER BY CASE WHEN team_id = ? THEN 0 ELSE 1 END, id LIMIT 1"
  )
  .bind(userId, primaryTeamId || 0)
  .first();

  return row ? row.id : null;
}


/* =========================================================
   入口
========================================================= */

export async function handleMemberApi(request, url, env) {

  var parts = url.pathname.split("/").filter(Boolean).slice(2);
  var method = request.method;

  if (parts[0] === "line" && parts[1] === "login" && method === "GET") {
    return lineLogin(request, url, env);
  }

  if (parts[0] === "line" && parts[1] === "callback" && method === "GET") {
    return lineCallback(request, url, env);
  }

  if (parts[0] === "me" && parts.length === 1 && method === "GET") {
    return jsonResponse({ success: true, member: publicMember(await getMember(request, env)) });
  }

  if (parts[0] === "logout" && method === "POST") {
    return logout(request, env);
  }

  /* 以下都要登入 */

  if (method !== "GET" && request.headers.get("X-OurSpace-Member") !== "1") {
    return errorResponse("CSRF_CHECK_FAILED", 403);
  }

  var member = await getMember(request, env);

  if (!member) {
    return errorResponse("LOGIN_REQUIRED", 401);
  }

  var id = parts[1] && isPositiveInteger(parts[1]) ? Number(parts[1]) : null;

  if (parts[0] === "profile" && method === "PUT") {
    return saveProfile(request, env, member);
  }

  if (parts[0] === "search" && method === "GET") {
    return searchMembers(url, env, member);
  }

  if (parts[0] === "register" && method === "POST") {
    return memberRegister(request, env, member);
  }

  if (parts[0] === "signups" && parts.length === 1 && method === "GET") {
    return mySignups(env, member);
  }

  if (parts[0] === "signups" && id && method === "DELETE") {
    return cancelSignup(env, member, id);
  }

  if (parts[0] === "history" && method === "GET") {
    return myHistory(env, member);
  }

  if (parts[0] === "placements" && method === "GET") {
    return myPlacements(env, member);
  }

  if (parts[0] === "players" && method === "GET") {
    return searchPlayers(url, env);
  }

  if (parts[0] === "claims" && parts.length === 1 && method === "POST") {
    return createClaim(request, env, member);
  }

  if (parts[0] === "claims" && id && method === "DELETE") {
    return cancelClaim(env, member, id);
  }

  if (parts[0] === "images" && method === "POST") {
    return uploadLogo(request, env, member);
  }

  if (parts[0] === "teams" && parts.length === 1 && method === "GET") {
    return myTeams(env, member);
  }

  if (parts[0] === "teams" && id && method === "POST") {

    if (parts[2] === "join" && parts.length === 3) {
      return joinTeam(env, member, id);
    }

    if (parts[2] === "leave" && parts.length === 3) {
      return leaveTeam(env, member, id);
    }

    if (parts[2] === "primary" && parts.length === 3) {
      return setPrimary(env, member, id);
    }

    if (parts[2] === "edit" && parts.length === 3) {
      return submitTeamEdit(request, env, member, id);
    }

    if (parts[2] === "members" && isPositiveInteger(parts[3]) && (parts[4] === "approve" || parts[4] === "remove")) {
      return captainAction(env, member, id, Number(parts[3]), parts[4]);
    }
  }

  return null;
}


/* =========================================================
   LINE 登入
========================================================= */

function callbackUrl(url) {
  return url.origin + "/api/member/line/callback";
}


async function lineLogin(request, url, env) {

  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET) {
    return redirect("/#login-error");
  }

  var state = randomHex(16);
  var back = url.searchParams.get("return") || "";

  /* 只允許站內的 # 頁面 */
  if (!/^#[a-z0-9/_-]{0,40}$/i.test(back)) {
    back = "#me";
  }

  var authorize =
    "https://access.line.me/oauth2/v2.1/authorize?response_type=code" +
    "&client_id=" + encodeURIComponent(env.LINE_CHANNEL_ID) +
    "&redirect_uri=" + encodeURIComponent(callbackUrl(url)) +
    "&state=" + state +
    "&scope=" + encodeURIComponent("profile openid") +
    (env.LINE_BOT_PROMPT ? "&bot_prompt=" + encodeURIComponent(env.LINE_BOT_PROMPT) : "");

  return redirect(authorize, [
    cookie(STATE_COOKIE, state + "|" + back, 600, "/api/member/line")
  ]);
}


async function lineCallback(request, url, env) {

  var saved = getCookie(request, STATE_COOKIE).split("|");
  var clearState = cookie(STATE_COOKIE, "", 0, "/api/member/line");
  var code = url.searchParams.get("code");
  var state = url.searchParams.get("state");

  if (!code || !state || state !== saved[0]) {
    return redirect("/#login-error", [clearState]);
  }

  try {

    var tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: callbackUrl(url),
        client_id: env.LINE_CHANNEL_ID,
        client_secret: env.LINE_CHANNEL_SECRET
      })
    });

    var token = await tokenResponse.json();

    if (!tokenResponse.ok || !token.id_token) {
      throw new Error("LINE token failed");
    }

    var verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: env.LINE_CHANNEL_ID })
    });

    var profile = await verifyResponse.json();

    if (!verifyResponse.ok || !profile.sub) {
      throw new Error("LINE verify failed");
    }

    var lineName = cleanText(profile.name).slice(0, 50) || "LINE 會員";
    var picture = /^https:\/\//.test(profile.picture || "") ? profile.picture : null;

    var user = await env.DB.prepare("SELECT id, status, nickname, phone FROM users WHERE line_user_id = ?")
      .bind(profile.sub)
      .first();

    if (!user) {

      var created = await env.DB.prepare(
        "INSERT INTO users (line_user_id, display_name, avatar_url, line_name, last_login_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(profile.sub, lineName, picture, lineName, taiwanNow())
      .run();

      user = { id: created.meta.last_row_id, status: "active", nickname: null, phone: null };

    } else {

      if (user.status !== "active") {
        return redirect("/#login-disabled", [clearState]);
      }

      await env.DB.prepare(
        "UPDATE users SET line_name = ?, avatar_url = ?, last_login_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .bind(lineName, picture, taiwanNow(), user.id)
      .run();
    }

    var sessionToken = randomHex(32);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO member_sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))"
      ).bind(user.id, await sha256Hex(sessionToken), "+" + SESSION_DAYS + " days"),
      env.DB.prepare("DELETE FROM member_sessions WHERE expires_at <= datetime('now')")
    ]);

    var next = !user.nickname || !user.phone ? "#join" : (saved[1] || "#me");

    return redirect("/" + next, [
      clearState,
      cookie(MEMBER_COOKIE, sessionToken, SESSION_DAYS * 86400, "/")
    ]);

  } catch (error) {
    console.error("LINE login failed:", error);
    return redirect("/#login-error", [clearState]);
  }
}


async function logout(request, env) {

  var token = getCookie(request, MEMBER_COOKIE);

  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM member_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }

  return jsonResponse({ success: true }, 200, 0, { "Set-Cookie": cookie(MEMBER_COOKIE, "", 0, "/") });
}


/* =========================================================
   會員資料
========================================================= */

async function saveProfile(request, env, member) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var nickname = cleanText(body.nickname);
  var phone = cleanText(body.phone);
  var teamId = isPositiveInteger(body.primary_team_id) ? Number(body.primary_team_id) : null;

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  if (!validPhone(phone)) {
    return errorResponse("INVALID_PHONE", 400, { field: "phone" });
  }

  var statements = [
    env.DB.prepare(
      "UPDATE users SET nickname = ?, display_name = ?, phone = ?, joined_at = COALESCE(joined_at, ?), " +
      "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(nickname, nickname, phone, taiwanNow(), member.id)
  ];

  if (teamId) {

    var team = await env.DB.prepare("SELECT id FROM teams WHERE id = ? AND status = 'active'").bind(teamId).first();

    if (!team) {
      return errorResponse("TEAM_NOT_FOUND", 404);
    }

    /* 還沒在這個戰隊：送出加入申請；已經是隊員：設為主要戰隊 */
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO member_teams (user_id, team_id, status) VALUES (?, ?, 'pending')"
      ).bind(member.id, teamId)
    );

    statements.push(
      env.DB.prepare(
        "UPDATE users SET primary_team_id = CASE WHEN EXISTS " +
        "(SELECT 1 FROM member_teams WHERE user_id = ? AND team_id = ? AND status = 'active') " +
        "THEN ? ELSE primary_team_id END WHERE id = ?"
      ).bind(member.id, teamId, teamId, member.id)
    );
  }

  await env.DB.batch(statements);
  await syncMemberToErp(env, member.id);

  return jsonResponse({ success: true, member: publicMember(await getMember(request, env)) });
}


async function searchMembers(url, env, member) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);

  if (keyword.length < 1) {
    return jsonResponse({ success: true, data: [] });
  }

  var digits = phoneDigits(keyword);
  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";


  var sql =
    "SELECT u.id, u.nickname, u.phone, t.team_name FROM users u " +
    "LEFT JOIN teams t ON t.id = u.primary_team_id " +
    "WHERE u.status = 'active' AND u.nickname IS NOT NULL AND u.id != ? AND (" +
    "u.nickname LIKE ? ESCAPE '\\' " +
    (digits.length >= 3 ? "OR replace(replace(u.phone, '-', ''), ' ', '') LIKE ? " : "") +
    ") ORDER BY u.nickname LIMIT 8";

  var statement = env.DB.prepare(sql);

  statement = digits.length >= 3
    ? statement.bind(member.id, like, "%" + digits.slice(-3))
    : statement.bind(member.id, like);

  var rows = await statement.all();

  return jsonResponse({
    success: true,
    data: (rows.results || []).map(function (row) {
      return { id: row.id, nickname: row.nickname, team_name: row.team_name, phone_tail: maskPhone(row.phone) };
    })
  });
}


/* =========================================================
   報名
   body: { event_ids, self: true/false, member_ids: [], names: [] }
========================================================= */

async function memberRegister(request, env, member) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  if (!member.nickname) {
    return errorResponse("PROFILE_REQUIRED", 403);
  }

  var eventIds = cleanEventIds(body.event_ids);

  if (!eventIds.length) {
    return errorResponse("REQUIRED", 400, { field: "event_ids" });
  }

  if (eventIds.length > SIGNUP_MAX_EVENTS) {
    return errorResponse("TOO_MANY_EVENTS", 400);
  }

  var people = [];
  var seen = {};

  function add(person) {
    var key = person.nickname.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      people.push(person);
    }
  }

  if (body.self !== false) {
    add({
      nickname: member.nickname,
      user_id: member.id,
      player_id: await memberPlayerId(env, member.id, member.primary_team_id),
      phone: member.phone
    });
  }

  var memberIds = cleanEventIds(body.member_ids).slice(0, SIGNUP_MAX_NAMES);

  for (var i = 0; i < memberIds.length; i++) {

    var other = await env.DB.prepare(
      "SELECT id, nickname, phone, primary_team_id FROM users WHERE id = ? AND status = 'active' AND nickname IS NOT NULL"
    )
    .bind(memberIds[i])
    .first();

    if (other) {
      add({
        nickname: other.nickname,
        user_id: other.id,
        player_id: await memberPlayerId(env, other.id, other.primary_team_id),
        phone: other.phone
      });
    }
  }

  var names = Array.isArray(body.names) ? body.names : [];

  for (var j = 0; j < names.length; j++) {

    var name = cleanText(names[j]);

    if (!name) {
      continue;
    }

    if (!validName(name)) {
      return errorResponse("INVALID_NAME", 400, { field: "names", value: name.slice(0, 30) });
    }

    add({ nickname: name, user_id: null, player_id: null, phone: null });
  }

  if (!people.length) {
    return errorResponse("REQUIRED", 400, { field: "names" });
  }

  if (people.length > SIGNUP_MAX_NAMES) {
    return errorResponse("TOO_MANY_NAMES", 400);
  }

  return registerPeople(request, env, eventIds, people, member.id);
}


async function mySignups(env, member) {

  var result = await env.DB.prepare(
    "SELECT c.id, c.nickname, c.user_id, c.registered_by, c.checked_in, c.checkin_number, " +
    "e.id AS event_id, e.title, e.event_date, e.start_time " +
    "FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    "WHERE (c.user_id = ? OR c.registered_by = ?) AND e.archived_at IS NULL AND e.event_date >= ? " +
    "ORDER BY e.event_date, e.id, c.id"
  )
  .bind(member.id, member.id, taiwanToday())
  .all();

  return jsonResponse({
    success: true,
    data: (result.results || []).map(function (row) {
      return {
        id: row.id,
        event_id: row.event_id,
        title: row.title,
        event_date: row.event_date,
        start_time: row.start_time,
        nickname: row.nickname,
        is_self: row.user_id === member.id,
        checked_in: row.checked_in,
        checkin_number: row.checkin_number,
        can_cancel: Number(row.checked_in) !== 1
      };
    })
  });
}


async function cancelSignup(env, member, entryId) {

  var row = await env.DB.prepare(
    "SELECT c.id, c.checked_in, c.user_id, c.registered_by, e.archived_at FROM checkin_entries c " +
    "INNER JOIN checkin_events e ON e.id = c.event_id WHERE c.id = ?"
  )
  .bind(entryId)
  .first();

  if (!row || (row.user_id !== member.id && row.registered_by !== member.id)) {
    return errorResponse("ENTRY_NOT_FOUND", 404);
  }

  if (Number(row.checked_in) === 1 || row.archived_at) {
    return errorResponse("ALREADY_CHECKED_IN", 409);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM checkin_lottery_wins WHERE entry_id = ?").bind(entryId),
    env.DB.prepare("DELETE FROM checkin_entries WHERE id = ?").bind(entryId)
  ]);

  return jsonResponse({ success: true });
}


async function myHistory(env, member) {

  var result = await env.DB.prepare(
    "SELECT e.id, e.title, e.event_date, e.event_type, c.checkin_number, " +
    "(SELECT r.rank_label FROM checkin_results r WHERE r.entry_id = c.id ORDER BY r.sort LIMIT 1) AS rank_label " +
    "FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    "WHERE c.user_id = ? AND c.checked_in = 1 AND e.archived_at IS NOT NULL " +
    "ORDER BY e.event_date DESC, e.id DESC LIMIT 100"
  )
  .bind(member.id)
  .all();

  return jsonResponse({ success: true, data: result.results || [] });
}


/* =========================================================
   上位紀錄 / 認領選手資料
========================================================= */

async function myPlacements(env, member) {

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT pp.event_date, pp.event_name, pp.participant_count, pp.placement, t.team_name " +
      "FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id " +
      "LEFT JOIN teams t ON t.id = p.team_id " +
      "WHERE p.user_id = ? ORDER BY pp.event_date DESC, pp.id DESC LIMIT 100"
    ).bind(member.id),
    env.DB.prepare(
      "SELECT c.id, c.status, c.note, c.created_at, p.id AS player_id, " +
      "COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, t.team_name " +
      "FROM player_claims c INNER JOIN players p ON p.id = c.player_id " +
      "LEFT JOIN teams t ON t.id = p.team_id " +
      "WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 30"
    ).bind(member.id),
    env.DB.prepare(
      "SELECT p.id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, t.team_name " +
      "FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.user_id = ? ORDER BY p.id"
    ).bind(member.id)
  ]);

  return jsonResponse({
    success: true,
    placements: results[0].results || [],
    claims: results[1].results || [],
    players: results[2].results || []
  });
}


async function searchPlayers(url, env) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);

  if (!keyword) {
    return jsonResponse({ success: true, data: [] });
  }

  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";

  var result = await env.DB.prepare(
    "SELECT p.id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, t.team_name, " +
    "(SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count, " +
    "CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS claimed " +
    "FROM players p LEFT JOIN teams t ON t.id = p.team_id " +
    "WHERE p.status = 'active' AND (p.nickname LIKE ? ESCAPE '\\' OR p.player_name LIKE ? ESCAPE '\\') " +
    "ORDER BY p.nickname LIMIT 10"
  )
  .bind(like, like)
  .all();

  return jsonResponse({ success: true, data: result.results || [] });
}


async function createClaim(request, env, member) {

  var body = (await parseJsonBody(request)) || {};

  if (!isPositiveInteger(body.player_id)) {
    return errorResponse("REQUIRED", 400, { field: "player_id" });
  }

  var player = await env.DB.prepare("SELECT id, user_id FROM players WHERE id = ? AND status = 'active'")
    .bind(Number(body.player_id))
    .first();

  if (!player) {
    return errorResponse("PLAYER_NOT_FOUND", 404);
  }

  if (player.user_id === member.id) {
    return errorResponse("ALREADY_CLAIMED", 409);
  }

  var pending = await env.DB.prepare(
    "SELECT id FROM player_claims WHERE user_id = ? AND player_id = ? AND status = 'pending'"
  )
  .bind(member.id, player.id)
  .first();

  if (pending) {
    return errorResponse("ALREADY_PENDING", 409);
  }

  await env.DB.prepare("INSERT INTO player_claims (user_id, player_id) VALUES (?, ?)")
    .bind(member.id, player.id)
    .run();

  return jsonResponse({ success: true }, 201);
}


async function cancelClaim(env, member, id) {

  await env.DB.prepare("DELETE FROM player_claims WHERE id = ? AND user_id = ? AND status = 'pending'")
    .bind(id, member.id)
    .run();

  return jsonResponse({ success: true });
}


/* =========================================================
   戰隊
========================================================= */

async function myTeams(env, member) {

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT t.id, t.team_name, t.team_logo_url, t.captain_user_id, mt.status " +
      "FROM member_teams mt INNER JOIN teams t ON t.id = mt.team_id " +
      "WHERE mt.user_id = ? AND t.status = 'active' ORDER BY mt.id"
    ).bind(member.id),
    env.DB.prepare(
      "SELECT id, team_name FROM teams WHERE status = 'active' ORDER BY team_name"
    ),
    env.DB.prepare(
      "SELECT t.id AS team_id, u.id AS user_id, u.nickname, mt.status " +
      "FROM teams t INNER JOIN member_teams mt ON mt.team_id = t.id INNER JOIN users u ON u.id = mt.user_id " +
      "WHERE t.captain_user_id = ? AND u.status = 'active' AND u.id != ? ORDER BY mt.status DESC, u.nickname"
    ).bind(member.id, member.id),
    env.DB.prepare(
      "SELECT team_id, status, created_at FROM team_edit_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10"
    ).bind(member.id)
  ]);

  var people = results[2].results || [];
  var edits = results[3].results || [];

  var mine = (results[0].results || []).map(function (team) {

    var captain = team.captain_user_id === member.id;
    var lastEdit = null;

    edits.forEach(function (edit) {
      if (!lastEdit && edit.team_id === team.id) {
        lastEdit = edit;
      }
    });

    return {
      id: team.id,
      team_name: team.team_name,
      team_logo_url: team.team_logo_url,
      status: team.status,
      is_primary: team.id === member.primary_team_id,
      is_captain: captain,
      edit_status: lastEdit ? lastEdit.status : null,
      members: captain ? people.filter(function (p) { return p.team_id === team.id; }) : []
    };
  });

  return jsonResponse({ success: true, data: mine, teams: results[1].results || [] });
}


async function joinTeam(env, member, teamId) {

  var team = await env.DB.prepare("SELECT id, captain_user_id FROM teams WHERE id = ? AND status = 'active'")
    .bind(teamId)
    .first();

  if (!team) {
    return errorResponse("TEAM_NOT_FOUND", 404);
  }

  /* 隊長本人直接是隊員 */
  var status = team.captain_user_id === member.id ? "active" : "pending";

  await env.DB.prepare(
    "INSERT OR IGNORE INTO member_teams (user_id, team_id, status, approved_at) VALUES (?, ?, ?, ?)"
  )
  .bind(member.id, teamId, status, status === "active" ? taiwanNow() : null)
  .run();

  return jsonResponse({ success: true });
}


async function leaveTeam(env, member, teamId) {

  await env.DB.batch([
    env.DB.prepare("DELETE FROM member_teams WHERE user_id = ? AND team_id = ?").bind(member.id, teamId),
    env.DB.prepare("UPDATE users SET primary_team_id = NULL WHERE id = ? AND primary_team_id = ?").bind(member.id, teamId)
  ]);

  await syncMemberToErp(env, member.id);

  return jsonResponse({ success: true });
}


async function setPrimary(env, member, teamId) {

  var row = await env.DB.prepare(
    "SELECT id FROM member_teams WHERE user_id = ? AND team_id = ? AND status = 'active'"
  )
  .bind(member.id, teamId)
  .first();

  if (!row) {
    return errorResponse("NOT_TEAM_MEMBER", 403);
  }

  await env.DB.prepare("UPDATE users SET primary_team_id = ? WHERE id = ?").bind(teamId, member.id).run();
  await syncMemberToErp(env, member.id);

  return jsonResponse({ success: true });
}


async function isCaptain(env, member, teamId) {

  var team = await env.DB.prepare("SELECT captain_user_id FROM teams WHERE id = ? AND status = 'active'")
    .bind(teamId)
    .first();

  return !!team && team.captain_user_id === member.id;
}


async function captainAction(env, member, teamId, userId, action) {

  if (!(await isCaptain(env, member, teamId))) {
    return errorResponse("FORBIDDEN", 403);
  }

  if (action === "approve") {

    await env.DB.prepare(
      "UPDATE member_teams SET status = 'active', approved_at = ? WHERE team_id = ? AND user_id = ?"
    )
    .bind(taiwanNow(), teamId, userId)
    .run();

    /* 還沒有主要戰隊的，自動設成這一隊 */
    await env.DB.prepare("UPDATE users SET primary_team_id = ? WHERE id = ? AND primary_team_id IS NULL")
      .bind(teamId, userId)
      .run();

  } else {

    await env.DB.batch([
      env.DB.prepare("DELETE FROM member_teams WHERE team_id = ? AND user_id = ?").bind(teamId, userId),
      env.DB.prepare("UPDATE users SET primary_team_id = NULL WHERE id = ? AND primary_team_id = ?").bind(userId, teamId)
    ]);
  }

  await syncMemberToErp(env, userId);

  return jsonResponse({ success: true });
}


async function submitTeamEdit(request, env, member, teamId) {

  if (!(await isCaptain(env, member, teamId))) {
    return errorResponse("FORBIDDEN", 403);
  }

  var body = (await parseJsonBody(request)) || {};
  var description = String(body.description || "").replace(/\r\n?/g, "\n").trim().slice(0, 1000);
  var logoId = isPositiveInteger(body.logo_image_id) ? Number(body.logo_image_id) : null;

  if (!description && !logoId) {
    return errorResponse("REQUIRED", 400);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM team_edit_requests WHERE team_id = ? AND status = 'pending'").bind(teamId),
    env.DB.prepare(
      "INSERT INTO team_edit_requests (team_id, user_id, description, logo_image_id) VALUES (?, ?, ?, ?)"
    ).bind(teamId, member.id, description || null, logoId)
  ]);

  return jsonResponse({ success: true }, 201);
}


async function uploadLogo(request, env, member) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var data = String(body.data || "");

  if (body.mime !== "image/jpeg" || !data || data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
    return errorResponse("IMAGE_TOO_LARGE", 400);
  }

  var result = await env.DB.prepare("INSERT INTO site_images (mime, data, created_by) VALUES (?, ?, ?)")
    .bind("image/jpeg", data, "member:" + member.id)
    .run();

  return jsonResponse({ success: true, data: { id: result.meta.last_row_id, url: imageUrl(result.meta.last_row_id) } }, 201);
}
