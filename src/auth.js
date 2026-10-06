/* =========================================================
   OURSPACE
   後台登入 / Session / 權限
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText
} from "./util.js";


var SESSION_COOKIE = "os_staff";
var SESSION_HOURS = 12;

/* Cloudflare Workers 的 PBKDF2 上限是 100000 次 */
var PBKDF2_ITERATIONS = 100000;

var MAX_FAILED_LOGINS = 5;
var LOCK_MINUTES = 15;

/* 後台前端每個寫入請求都必須帶這個標頭（防 CSRF） */
export var ADMIN_HEADER = "X-OurSpace-Admin";

export var STAFF_ROLES = ["admin", "referee"];


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


export async function createPasswordRecord(password) {

  var salt = randomHex(16);

  return {
    salt: salt,
    hash: await hashPassword(password, salt)
  };

}


/* =========================================================
   驗證規則
========================================================= */

export function validateUsername(username) {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(username);
}


export function validatePassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 72;
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


async function createSession(env, staffId) {

  var token = randomHex(32);

  await env.DB.prepare(
    "INSERT INTO staff_sessions (staff_id, token_hash, expires_at) " +
    "VALUES (?, ?, datetime('now', ?))"
  )
  .bind(staffId, await sha256Hex(token), "+" + SESSION_HOURS + " hours")
  .run();

  return sessionCookie(token, SESSION_HOURS * 3600);

}


export async function getSessionStaff(request, env) {

  var token = getCookie(request, SESSION_COOKIE);

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  var staff =
    await env.DB.prepare(
      "SELECT u.id, u.username, u.display_name, u.role " +
      "FROM staff_sessions s " +
      "INNER JOIN staff_users u ON s.staff_id = u.id " +
      "WHERE s.token_hash = ? " +
      "AND s.expires_at > datetime('now') " +
      "AND u.status = 'active'"
    )
    .bind(await sha256Hex(token))
    .first();

  return staff || null;

}


export async function deleteStaffSessions(env, staffId) {

  await env.DB.prepare("DELETE FROM staff_sessions WHERE staff_id = ?")
    .bind(staffId)
    .run();

}


function publicStaff(staff) {

  return {
    id: staff.id,
    username: staff.username,
    display_name: staff.display_name,
    role: staff.role
  };

}


/* 給其他 API 用：檢查登入與角色 */
export async function requireStaff(request, env, roles) {

  if (request.method !== "GET" && request.headers.get(ADMIN_HEADER) !== "1") {
    return { response: errorResponse("CSRF_CHECK_FAILED", 403) };
  }

  var staff = await getSessionStaff(request, env);

  if (!staff) {
    return { response: errorResponse("UNAUTHORIZED", 401) };
  }

  if (roles && roles.indexOf(staff.role) === -1) {
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


async function needsSetup(env) {

  var row = await env.DB.prepare("SELECT COUNT(*) AS total FROM staff_users").first();

  return !row || row.total === 0;

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

  if (pathname === "/api/auth/setup" && method === "POST") {
    return setup(request, env);
  }

  return null;

}


async function getMe(request, env) {

  var staff = await getSessionStaff(request, env);

  if (staff) {
    return jsonResponse({ success: true, staff: publicStaff(staff) });
  }

  return jsonResponse({
    success: true,
    staff: null,
    needs_setup: await needsSetup(env)
  });

}


async function login(request, env) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var username = cleanText(body.username);
  var password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  var user =
    await env.DB.prepare(
      "SELECT id, username, display_name, role, status, " +
      "password_hash, password_salt, " +
      "(locked_until IS NOT NULL AND locked_until > datetime('now')) AS is_locked " +
      "FROM staff_users WHERE username = ?"
    )
    .bind(username)
    .first();

  if (!user) {

    /* 帳號不存在也做一次雜湊，避免從回應時間猜出帳號是否存在 */
    await hashPassword(password, "00000000000000000000000000000000");

    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  if (user.is_locked) {
    return errorResponse("ACCOUNT_LOCKED", 429);
  }

  var hash = await hashPassword(password, user.password_salt);

  if (!equalHex(hash, user.password_hash) || user.status !== "active") {

    await env.DB.prepare(
      "UPDATE staff_users SET " +
      "failed_count = failed_count + 1, " +
      "locked_until = CASE WHEN failed_count + 1 >= ? " +
      "THEN datetime('now', ?) ELSE locked_until END " +
      "WHERE id = ?"
    )
    .bind(MAX_FAILED_LOGINS, "+" + LOCK_MINUTES + " minutes", user.id)
    .run();

    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE staff_users SET failed_count = 0, locked_until = NULL, " +
      "last_login_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(user.id),
    env.DB.prepare(
      "DELETE FROM staff_sessions WHERE expires_at <= datetime('now')"
    )
  ]);

  var cookie = await createSession(env, user.id);

  await writeAuditLog(env, user, "login", "staff_users", user.id);

  return jsonResponse(
    { success: true, staff: publicStaff(user) },
    200,
    0,
    { "Set-Cookie": cookie }
  );

}


async function logout(request, env) {

  var token = getCookie(request, SESSION_COOKIE);

  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM staff_sessions WHERE token_hash = ?")
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


/* 第一次使用：沒有任何後台帳號時，用 SETUP_KEY 建立第一個管理員 */
async function setup(request, env) {

  if (!env.SETUP_KEY) {
    return errorResponse("SETUP_KEY_NOT_CONFIGURED", 503);
  }

  if (!(await needsSetup(env))) {
    return errorResponse("ALREADY_SET_UP", 409);
  }

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var keyMatches = equalHex(
    await sha256Hex(cleanText(body.setup_key)),
    await sha256Hex(env.SETUP_KEY)
  );

  if (!keyMatches) {
    return errorResponse("INVALID_SETUP_KEY", 403);
  }

  var username = cleanText(body.username);
  var displayName = cleanText(body.display_name);
  var password = typeof body.password === "string" ? body.password : "";

  if (!validateUsername(username)) {
    return errorResponse("INVALID_USERNAME", 400);
  }

  if (!displayName || displayName.length > 50) {
    return errorResponse("INVALID_DISPLAY_NAME", 400);
  }

  if (!validatePassword(password)) {
    return errorResponse("WEAK_PASSWORD", 400);
  }

  var record = await createPasswordRecord(password);

  var result =
    await env.DB.prepare(
      "INSERT INTO staff_users " +
      "(username, display_name, role, password_hash, password_salt) " +
      "VALUES (?, ?, 'admin', ?, ?)"
    )
    .bind(username, displayName, record.hash, record.salt)
    .run();

  var staff = {
    id: result.meta.last_row_id,
    username: username,
    display_name: displayName,
    role: "admin"
  };

  var cookie = await createSession(env, staff.id);

  await writeAuditLog(env, staff, "setup", "staff_users", staff.id);

  return jsonResponse(
    { success: true, staff: staff },
    201,
    0,
    { "Set-Cookie": cookie }
  );

}
