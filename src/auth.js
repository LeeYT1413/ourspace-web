/* =========================================================
   OURSPACE
   後台登入 / Session / 權限

   帳號與權限以 ERP 為主：
   - 帳號密碼：ERP 資料庫（ERP_DB）的 Users 表，帳號 = ERP 的 Email
   - 官網後台可以看哪些頁面：ERP「系統設定 → 角色權限 → 官網後台」
   - 登入狀態：官網自己的 erp_sessions 表（同一組帳密，各自登入）
   - 裁判固定只能使用「裁判計分」
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText
} from "./util.js";


var SESSION_COOKIE = "os_staff";
var SESSION_HOURS = 12;

/* 要和 ERP src/util.js 的 PBKDF2_ITERATIONS 一致 */
var PBKDF2_ITERATIONS = 100000;

var MAX_FAILED_LOGINS = 5;
var LOCK_MINUTES = 15;

/* 後台前端每個寫入請求都必須帶這個標頭（防 CSRF） */
export var ADMIN_HEADER = "X-OurSpace-Admin";


/* =========================================================
   官網後台頁面與預設權限
   ⚠ 要和 ERP src/permissions.js 的 WEB_PAGES / DEFAULT_PERMISSIONS 一致
========================================================= */

export var WEB_PAGE_KEYS = [
  "events",
  "checkin",
  "lottery",
  "referee",
  "league_matches",
  "tournaments",
  "teams",
  "players",
  "news",
  "news_images",
  "contact_messages",
  "site_settings",
  "review",
  "members",
  "ads",
  "event_delete"
];

/* 動作權限：系統管理員一定有，其他角色預設沒有（在 ERP 權限表勾選） */
var WEB_DEFAULT_OFF = ["event_delete"];

var WEB_DEFAULT_KEYS = WEB_PAGE_KEYS.filter(function (key) {
  return WEB_DEFAULT_OFF.indexOf(key) === -1;
});

/* 頁面固定、不看 ERP 設定的角色 */
var WEB_FIXED_ROLES = { referee: ["referee"] };

var DEFAULT_WEB_PAGES = {
  admin: WEB_DEFAULT_KEYS,
  manager: WEB_DEFAULT_KEYS,
  store_manager: ["events", "checkin", "lottery", "referee", "league_matches", "tournaments", "news"],
  staff: [],
  supplier: []
};

/* 可以刪除場次等「管理員等級」操作的角色 */
export var MANAGER_ROLES = ["sysadmin", "admin"];


/* =========================================================
   密碼 / Token
========================================================= */

var encoder = new TextEncoder();


function toHex(buffer) {

  return Array.from(new Uint8Array(buffer))
    .map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");

}


function hexToBytes(hex) {

  var bytes = new Uint8Array(hex.length / 2);

  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return bytes;

}


function randomHex(byteLength) {

  var bytes = new Uint8Array(byteLength);

  crypto.getRandomValues(bytes);

  return toHex(bytes);

}


async function sha256Hex(text) {

  return toHex(
    await crypto.subtle.digest("SHA-256", encoder.encode(String(text)))
  );

}


function equalHex(a, b) {

  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  var result = 0;

  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;

}


/* 和 ERP 相同的雜湊方式：PBKDF2-SHA256、100000 次、256 bits */
async function hashPassword(password, saltHex) {

  var key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  var bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS
    },
    key,
    256
  );

  return toHex(bits);

}


/* =========================================================
   ERP 權限
========================================================= */

function erpDb(env) {

  if (!env.ERP_DB) {
    throw new Error("ERP_DB binding is not configured");
  }

  return env.ERP_DB;

}


async function loadWebPages(env, role) {

  role = String(role || "").toLowerCase();

  if (WEB_FIXED_ROLES[role]) {
    return WEB_FIXED_ROLES[role].slice();
  }

  if (role === "sysadmin") {
    return WEB_PAGE_KEYS.slice();
  }

  var stored = null;

  try {

    var row = await erpDb(env).prepare(
      "SELECT setting_value FROM Settings WHERE setting_key = 'role_permissions'"
    ).first();

    if (row && row.setting_value) {
      var all = JSON.parse(row.setting_value) || {};
      stored = all[role] || null;
    }

  } catch (error) {
    stored = null;
  }

  var list = stored && Array.isArray(stored.web_pages)
    ? stored.web_pages
    : (DEFAULT_WEB_PAGES[role] || []);

  return WEB_PAGE_KEYS.filter(function (key) {
    return list.indexOf(key) !== -1;
  });

}


async function getErpUserById(env, userId) {

  return erpDb(env).prepare(
    "SELECT user_id, user_name, email, role, role_name, enabled " +
    "FROM Users WHERE user_id = ? LIMIT 1"
  )
  .bind(userId)
  .first();

}


async function buildStaff(env, user) {

  return {
    id: user.user_id,
    username: user.email,
    display_name: user.user_name,
    role: String(user.role || "").toLowerCase(),
    role_name: user.role_name || user.role,
    pages: await loadWebPages(env, user.role)
  };

}


/* =========================================================
   Cookie / Session
========================================================= */

function getCookie(request, name) {

  var header = request.headers.get("Cookie") || "";
  var parts = header.split(";");

  for (var i = 0; i < parts.length; i++) {

    var pair = parts[i].trim();
    var index = pair.indexOf("=");

    if (index > 0 && pair.slice(0, index) === name) {
      return pair.slice(index + 1);
    }
  }

  return "";

}


function sessionCookie(token, maxAge) {

  return (
    SESSION_COOKIE + "=" + token +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge
  );

}


async function createSession(env, userId) {

  var token = randomHex(32);

  await env.DB.prepare(
    "INSERT INTO erp_sessions (user_id, token_hash, expires_at) " +
    "VALUES (?, ?, datetime('now', ?))"
  )
  .bind(userId, await sha256Hex(token), "+" + SESSION_HOURS + " hours")
  .run();

  return sessionCookie(token, SESSION_HOURS * 3600);

}


/* 每次請求都重新讀 ERP：帳號停用、改角色、改權限都會立即生效 */
export async function getSessionStaff(request, env) {

  var token = getCookie(request, SESSION_COOKIE);

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  var session = await env.DB.prepare(
    "SELECT user_id FROM erp_sessions " +
    "WHERE token_hash = ? AND expires_at > datetime('now')"
  )
  .bind(await sha256Hex(token))
  .first();

  if (!session) {
    return null;
  }

  var user = await getErpUserById(env, session.user_id);

  if (!user || Number(user.enabled) !== 1) {
    return null;
  }

  var staff = await buildStaff(env, user);

  if (!staff.pages.length) {
    return null;
  }

  return staff;

}


export function canUsePage(staff, page) {

  if (!staff) {
    return false;
  }

  if (!page) {
    return staff.pages.length > 0;
  }

  var list = Array.isArray(page) ? page : [page];

  for (var i = 0; i < list.length; i++) {
    if (staff.pages.indexOf(list[i]) !== -1) {
      return true;
    }
  }

  return false;

}


/*
  給其他 API 用：檢查登入與頁面權限
  page：頁面代碼或陣列（有其中一個就可以）；不給 = 只要能進官網後台
*/
export async function requireStaff(request, env, page) {

  if (request.method !== "GET" && request.headers.get(ADMIN_HEADER) !== "1") {
    return { response: errorResponse("CSRF_CHECK_FAILED", 403) };
  }

  var staff = await getSessionStaff(request, env);

  if (!staff) {
    return { response: errorResponse("UNAUTHORIZED", 401) };
  }

  if (page && !canUsePage(staff, page)) {
    return { response: errorResponse("FORBIDDEN", 403) };
  }

  return { staff: staff };

}


export async function writeAuditLog(env, staff, action, targetType, targetId, detail) {

  try {

    await env.DB.prepare(
      "INSERT INTO audit_logs (staff_id, action, target_type, target_id, detail) " +
      "VALUES (?, ?, ?, ?, ?)"
    )
    .bind(
      staff ? staff.id : null,
      action,
      targetType || null,
      targetId || null,
      detail ? JSON.stringify(detail).slice(0, 2000) : null
    )
    .run();

  } catch (error) {
    console.error("Audit log failed:", error);
  }

}


/* =========================================================
   /api/auth/*
========================================================= */

export async function handleAuthApi(request, url, env) {

  var pathname = url.pathname;
  var method = request.method;

  if (method !== "GET" && request.headers.get(ADMIN_HEADER) !== "1") {
    return errorResponse("CSRF_CHECK_FAILED", 403);
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    return getMe(request, env);
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    return login(request, env);
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    return logout(request, env);
  }

  return null;

}


async function getMe(request, env) {

  var staff = await getSessionStaff(request, env);

  return jsonResponse({
    success: true,
    staff: staff,
    needs_setup: false
  });

}


/* 登入失敗次數記在官網資料庫（以 Email 為單位） */
async function isLocked(env, account) {

  var row = await env.DB.prepare(
    "SELECT 1 AS locked FROM login_attempts " +
    "WHERE account = ? AND locked_until IS NOT NULL AND locked_until > datetime('now')"
  )
  .bind(account)
  .first();

  return !!row;

}


async function recordFailure(env, account) {

  await env.DB.prepare(
    "INSERT INTO login_attempts (account, failed_count, locked_until) VALUES (?, 1, NULL) " +
    "ON CONFLICT(account) DO UPDATE SET " +
    "failed_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') " +
    "THEN 1 ELSE failed_count + 1 END, " +
    "locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') " +
    "THEN 1 ELSE failed_count + 1 END) >= ? THEN datetime('now', ?) ELSE NULL END"
  )
  .bind(account, MAX_FAILED_LOGINS, "+" + LOCK_MINUTES + " minutes")
  .run();

}


async function login(request, env) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var account = cleanText(body.username).toLowerCase();
  var password = typeof body.password === "string" ? body.password : "";

  if (!account || !password || account.length > 200) {
    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  if (await isLocked(env, account)) {
    return errorResponse("ACCOUNT_LOCKED", 429);
  }

  var user = await erpDb(env).prepare(
    "SELECT user_id, user_name, email, role, role_name, enabled, " +
    "password_hash, password_salt, must_change_password " +
    "FROM Users WHERE LOWER(email) = LOWER(?) LIMIT 1"
  )
  .bind(account)
  .first();

  if (!user || !user.password_hash || !user.password_salt) {

    /* 帳號不存在也做一次雜湊，避免從回應時間猜出帳號是否存在 */
    await hashPassword(password, "00000000000000000000000000000000");
    await recordFailure(env, account);

    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  var hash = await hashPassword(password, user.password_salt);

  if (!equalHex(hash, user.password_hash)) {
    await recordFailure(env, account);
    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  if (Number(user.enabled) !== 1) {
    return errorResponse("ACCOUNT_DISABLED", 403);
  }

  if (Number(user.must_change_password) === 1) {
    return errorResponse("MUST_CHANGE_PASSWORD", 403);
  }

  var staff = await buildStaff(env, user);

  if (!staff.pages.length) {
    return errorResponse("NO_WEB_ACCESS", 403);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE account = ?").bind(account),
    env.DB.prepare("DELETE FROM erp_sessions WHERE expires_at <= datetime('now')")
  ]);

  var cookie = await createSession(env, user.user_id);

  await writeAuditLog(env, staff, "login", "erp_users", null, { user_id: user.user_id });

  return jsonResponse(
    { success: true, staff: staff },
    200,
    0,
    { "Set-Cookie": cookie }
  );

}


async function logout(request, env) {

  var token = getCookie(request, SESSION_COOKIE);

  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM erp_sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
  }

  return jsonResponse(
    { success: true },
    200,
    0,
    { "Set-Cookie": sessionCookie("", 0) }
  );

}
