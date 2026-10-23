/* =========================================================
   OURSPACE
   比賽賽程（會員自己建立的單淘汰對戰表）
   資料放在獨立的資料庫 BRACKET_DB（ourspace-bracket-db）

   誰可以做什麼
   - 看賽程：任何人拿到連結都能看（不用登入）
   - 建立賽程：先只開放「窩室」戰隊的正式隊員
   - 輸入勝負：建立者，以及建立者指定的協助者（最多 10 位會員）
   - 每位會員最多 200 筆賽程，超過要先刪除舊的

   API
     GET    /api/brackets/view/:code        看賽程（公開）
     GET    /api/brackets/access            我能不能建立賽程
     GET    /api/brackets/mine              我建立的、我協助的
     GET    /api/brackets/members?q=        找會員（加協助者）
     POST   /api/brackets                   建立（存成草稿）
     GET    /api/brackets/:id               取得草稿（建立者）
     PUT    /api/brackets/:id               修改草稿
     DELETE /api/brackets/:id               刪除（建立者）
     POST   /api/brackets/:id/start         建立對戰表（之後不能換對手）
     POST   /api/brackets/:id/result        { code, winner: 'a' | 'b' | null }
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow
} from "./util.js";

import { getMember } from "./member-api.js";


var MAX_BRACKETS = 200;
var MAX_HELPERS = 10;
var MAX_PARTICIPANTS = 1024;
var OPEN_TEAM = "窩室";
var FORMATS = ["champ", "top4", "top8"];


/* =========================================================
   會員主檔同步（官網 → 賽程資料庫）；失敗不影響官網
========================================================= */

export async function syncMemberToBracket(env, userId) {

  if (!env.BRACKET_DB) {
    return;
  }

  try {

    var user = await env.DB.prepare("SELECT id, nickname, status FROM users WHERE id = ?").bind(userId).first();

    if (!user || !user.nickname) {
      return;
    }

    var teams = await env.DB.prepare(
      "SELECT t.team_name FROM member_teams mt INNER JOIN teams t ON t.id = mt.team_id " +
      "WHERE mt.user_id = ? AND mt.status = 'active' AND t.status = 'active' ORDER BY t.team_name"
    ).bind(userId).all();

    var names = (teams.results || []).map(function (row) { return row.team_name; });

    await env.BRACKET_DB.prepare(
      "INSERT INTO members (member_id, nickname, team_names, is_ourspace, status, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(member_id) DO UPDATE SET nickname = excluded.nickname, team_names = excluded.team_names, " +
      "is_ourspace = excluded.is_ourspace, status = excluded.status, updated_at = CURRENT_TIMESTAMP"
    )
    .bind(user.id, user.nickname, names.join("、") || null, names.indexOf(OPEN_TEAM) !== -1 ? 1 : 0, user.status)
    .run();

  } catch (error) {
    console.error("bracket member sync failed:", error);
  }
}


async function isOpenFor(env, member) {

  if (!member || !env.BRACKET_DB) {
    return false;
  }

  var row = await env.DB.prepare(
    "SELECT 1 AS ok FROM member_teams mt INNER JOIN teams t ON t.id = mt.team_id " +
    "WHERE mt.user_id = ? AND mt.status = 'active' AND t.team_name = ? LIMIT 1"
  ).bind(member.id, OPEN_TEAM).first();

  return !!row;
}


/* =========================================================
   對戰表產生與計算
========================================================= */

function randomCode(length) {

  var chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var bytes = new Uint8Array(length);
  var text = "";

  crypto.getRandomValues(bytes);

  for (var i = 0; i < length; i++) {
    text += chars[bytes[i] % chars.length];
  }

  return text;
}


/*
  第一輪照名單順序兩兩對戰（1 對 2、3 對 4…）
  人數不是 2 的次方時，輪空平均分散，不會兩個輪空碰在一起
  賽制：champ 奪冠賽、top4 四強（加季軍戰）、top8 八強（再加第 5～8 名排位）
*/
export function buildMatches(names, format) {

  var size = 2;

  while (size < names.length) {
    size *= 2;
  }

  var rounds = Math.round(Math.log(size) / Math.LN2);
  var first = size / 2;
  var byes = size - names.length;
  var byeSlots = {};

  for (var b = 0; b < byes; b++) {
    byeSlots[Math.floor(b * first / byes)] = true;
  }

  var list = [];
  var sort = 1;
  var next = 0;

  for (var i = 0; i < first; i++) {

    var a = names[next++];
    var bye = !!byeSlots[i];

    list.push({
      code: "R1-" + (i + 1), round: 1, slot: i + 1, sort: sort++, title: null,
      a_name: a, b_name: bye ? null : names[next++],
      a_from: "SEED", b_from: bye ? "BYE" : "SEED"
    });
  }

  for (var r = 2; r <= rounds; r++) {

    var count = size / Math.pow(2, r);

    for (var j = 1; j <= count; j++) {
      list.push({
        code: "R" + r + "-" + j, round: r, slot: j, sort: sort++, title: null,
        a_name: null, b_name: null,
        a_from: "W:R" + (r - 1) + "-" + (j * 2 - 1), b_from: "W:R" + (r - 1) + "-" + (j * 2)
      });
    }
  }

  var place = rounds + 1;

  if ((format === "top4" || format === "top8") && rounds >= 2) {
    list.push({
      code: "T3", round: place, slot: 1, sort: sort++, title: "季軍戰",
      a_name: null, b_name: null,
      a_from: "L:R" + (rounds - 1) + "-1", b_from: "L:R" + (rounds - 1) + "-2"
    });
  }

  if (format === "top8" && rounds >= 3) {

    var q = rounds - 2;

    list.push({ code: "P1", round: place, slot: 2, sort: sort++, title: "5～8 名排位", a_name: null, b_name: null, a_from: "L:R" + q + "-1", b_from: "L:R" + q + "-2" });
    list.push({ code: "P2", round: place, slot: 3, sort: sort++, title: "5～8 名排位", a_name: null, b_name: null, a_from: "L:R" + q + "-3", b_from: "L:R" + q + "-4" });
    list.push({ code: "P5", round: place, slot: 4, sort: sort++, title: "第 5、6 名", a_name: null, b_name: null, a_from: "W:P1", b_from: "W:P2" });
    list.push({ code: "P7", round: place, slot: 5, sort: sort++, title: "第 7、8 名", a_name: null, b_name: null, a_from: "L:P1", b_from: "L:P2" });
  }

  return { matches: list, rounds: rounds };
}


var BYE = { bye: true };
var PENDING = { pending: true };


/* 依目前的勝負，算出每一場的雙方、狀態、勝方與敗方 */
export function resolveMatches(rows) {

  var map = {};
  var out = [];

  rows.slice().sort(function (x, y) { return x.sort - y.sort; }).forEach(function (m) {

    function side(from, name) {

      if (from === "SEED") {
        return { name: name };
      }

      if (from === "BYE") {
        return BYE;
      }

      var ref = map[from.slice(2)];

      if (!ref) {
        return PENDING;
      }

      return from.charAt(0) === "W" ? ref.win : ref.lose;
    }

    var a = side(m.a_from, m.a_name);
    var b = side(m.b_from, m.b_name);
    var state;
    var win = PENDING;
    var lose = PENDING;
    var winner = null;

    if (a.pending || b.pending) {
      state = "wait";
    } else if (a.bye || b.bye) {
      state = "bye";
      win = a.bye ? b : a;
      lose = BYE;
      winner = a.bye ? (b.bye ? null : "b") : "a";
    } else if (m.winner === "a" || m.winner === "b") {
      state = "done";
      winner = m.winner;
      win = m.winner === "a" ? a : b;
      lose = m.winner === "a" ? b : a;
    } else {
      state = "live";
    }

    map[m.code] = { win: win, lose: lose };

    out.push({
      code: m.code,
      round: m.round,
      slot: m.slot,
      sort: m.sort,
      title: m.title,
      a: a.name || null,
      b: b.name || null,
      a_state: a.pending ? "pending" : a.bye ? "bye" : "ok",
      b_state: b.pending ? "pending" : b.bye ? "bye" : "ok",
      state: state,
      winner: winner,
      a_from: m.a_from,
      b_from: m.b_from
    });
  });

  return { list: out, map: map };
}


function standings(resolved, rounds) {

  var map = resolved.map;

  function name(code, key) {
    var item = map[code];
    var value = item && item[key];
    if (value && value.bye) {
      return "—";
    }
    return value && value.name ? value.name : null;
  }

  var final = "R" + rounds + "-1";
  var rows = [["冠軍", name(final, "win")], ["亞軍", name(final, "lose")]];

  if (map.T3) {
    rows.push(["季軍", name("T3", "win")], ["殿軍", name("T3", "lose")]);
  }

  if (map.P5) {
    rows.push(["第 5 名", name("P5", "win")], ["第 6 名", name("P5", "lose")]);
    rows.push(["第 7 名", name("P7", "win")], ["第 8 名", name("P7", "lose")]);
  }

  return rows.map(function (row) { return { rank: row[0], name: row[1] }; });
}


function mainRounds(rows) {
  return rows.reduce(function (max, m) {
    return m.code.charAt(0) === "R" ? Math.max(max, m.round) : max;
  }, 1);
}


/* =========================================================
   入口
========================================================= */

export async function handleBracketApi(request, url, env) {

  var parts = url.pathname.split("/").filter(Boolean).slice(2);
  var method = request.method;

  if (!env.BRACKET_DB) {
    return parts[0] === "access"
      ? jsonResponse({ success: true, logged_in: false, allowed: false })
      : errorResponse("NOT_OPEN", 404);
  }

  if (parts[0] === "view" && parts[1] && method === "GET") {
    return viewBracket(request, env, parts[1]);
  }

  if (method !== "GET" && request.headers.get("X-OurSpace-Member") !== "1") {
    return errorResponse("CSRF_CHECK_FAILED", 403);
  }

  var member = await getMember(request, env);

  if (parts[0] === "access" && method === "GET") {

    var allowed = await isOpenFor(env, member);

    if (allowed) {
      await syncMemberToBracket(env, member.id);
    }

    return jsonResponse({ success: true, logged_in: !!member, allowed: allowed });
  }

  if (!member) {
    return errorResponse("LOGIN_REQUIRED", 401);
  }

  /* 輸入勝負：建立者指定的協助者都可以（不限窩室戰隊） */
  if (isPositiveInteger(parts[0]) && parts[1] === "result" && method === "POST") {
    return setResult(await parseJsonBody(request), env, member, Number(parts[0]));
  }

  if (!(await isOpenFor(env, member))) {
    return errorResponse("NOT_OPEN", 403);
  }

  await syncMemberToBracket(env, member.id);

  if (parts[0] === "mine" && method === "GET") {
    return myBrackets(env, member);
  }

  if (parts[0] === "members" && method === "GET") {
    return searchMembers(url, env, member);
  }

  if (!parts.length && method === "POST") {
    return saveDraft(await parseJsonBody(request), env, member, null);
  }

  if (isPositiveInteger(parts[0])) {

    var id = Number(parts[0]);

    if (parts.length === 1 && method === "GET") {
      return getDraft(env, member, id);
    }

    if (parts.length === 1 && method === "PUT") {
      return saveDraft(await parseJsonBody(request), env, member, id);
    }

    if (parts.length === 1 && method === "DELETE") {
      return deleteBracket(env, member, id);
    }

    if (parts[1] === "start" && method === "POST") {
      return startBracket(await parseJsonBody(request), env, member, id);
    }

    if (parts[1] === "result" && method === "POST") {
      return setResult(await parseJsonBody(request), env, member, id);
    }
  }

  return null;
}


/* =========================================================
   看賽程（公開）
========================================================= */

async function viewBracket(request, env, code) {

  if (!/^[A-Za-z0-9]{6,20}$/.test(code)) {
    return errorResponse("NOT_FOUND", 404);
  }

  var bracket = await env.BRACKET_DB.prepare(
    "SELECT b.*, m.nickname AS owner_name FROM brackets b LEFT JOIN members m ON m.member_id = b.owner_id " +
    "WHERE b.share_code = ? AND b.status != 'draft'"
  ).bind(code).first();

  if (!bracket) {
    return errorResponse("NOT_FOUND", 404);
  }

  var rows = (await env.BRACKET_DB.prepare("SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY sort")
    .bind(bracket.id).all()).results || [];

  var rounds = mainRounds(rows);
  var resolved = resolveMatches(rows);
  var member = await getMember(request, env);
  var helpers = parseIds(bracket.helpers);
  var canEdit = !!member && (member.id === bracket.owner_id || helpers.indexOf(member.id) !== -1);

  return jsonResponse({
    success: true,
    data: {
      id: bracket.id,
      share_code: bracket.share_code,
      title: bracket.title,
      event_date: bracket.event_date,
      format: bracket.format,
      status: bracket.status,
      owner_name: bracket.owner_name,
      is_owner: !!member && member.id === bracket.owner_id,
      players: parseNames(bracket.participants).length,
      rounds: rounds,
      matches: resolved.list,
      standings: standings(resolved, rounds),
      can_edit: canEdit
    }
  }, 200, 0);
}


/* =========================================================
   我的賽程 / 草稿
========================================================= */

function parseNames(text) {
  try {
    var list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function parseIds(text) {
  return parseNames(text).filter(isPositiveInteger).map(Number);
}


async function myBrackets(env, member) {

  var results = await env.BRACKET_DB.batch([
    env.BRACKET_DB.prepare(
      "SELECT id, share_code, title, event_date, format, status, participants, champion FROM brackets " +
      "WHERE owner_id = ? ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, " +
      "COALESCE(event_date, '') DESC, id DESC"
    ).bind(member.id),
    env.BRACKET_DB.prepare(
      "SELECT b.id, b.share_code, b.title, b.event_date, b.format, b.status, b.participants, b.champion, " +
      "m.nickname AS owner_name FROM brackets b LEFT JOIN members m ON m.member_id = b.owner_id " +
      "WHERE b.status != 'draft' AND b.owner_id != ? " +
      "AND EXISTS (SELECT 1 FROM json_each(b.helpers) h WHERE h.value = ?) ORDER BY b.id DESC LIMIT 100"
    ).bind(member.id, member.id)
  ]);

  function shape(row) {
    row.players = parseNames(row.participants).length;
    delete row.participants;
    return row;
  }

  var mine = (results[0].results || []).map(shape);

  return jsonResponse({
    success: true,
    limit: MAX_BRACKETS,
    count: mine.length,
    mine: mine,
    helping: (results[1].results || []).map(shape)
  });
}


async function searchMembers(url, env, member) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);

  if (!keyword) {
    return jsonResponse({ success: true, data: [] });
  }

  var digits = keyword.replace(/\D/g, "");
  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";
  var statement = env.DB.prepare(
    "SELECT u.id, u.nickname, u.phone, t.team_name FROM users u LEFT JOIN teams t ON t.id = u.primary_team_id " +
    "WHERE u.status = 'active' AND u.nickname IS NOT NULL AND u.id != ? AND (u.nickname LIKE ? ESCAPE '\\' " +
    (digits.length >= 3 ? "OR replace(replace(u.phone, '-', ''), ' ', '') LIKE ? " : "") +
    ") ORDER BY u.nickname LIMIT 8"
  );

  var rows = await (digits.length >= 3
    ? statement.bind(member.id, like, "%" + digits.slice(-3))
    : statement.bind(member.id, like)).all();

  return jsonResponse({
    success: true,
    data: (rows.results || []).map(function (row) {
      var tail = String(row.phone || "").replace(/\D/g, "").slice(-3);
      return { id: row.id, nickname: row.nickname, team_name: row.team_name, phone_tail: tail ? "末三碼 " + tail : "" };
    })
  });
}


async function ownBracket(env, member, id) {

  var bracket = await env.BRACKET_DB.prepare("SELECT * FROM brackets WHERE id = ?").bind(id).first();

  if (!bracket) {
    return { response: errorResponse("NOT_FOUND", 404) };
  }

  if (bracket.owner_id !== member.id) {
    return { response: errorResponse("FORBIDDEN", 403) };
  }

  return { bracket: bracket };
}


async function getDraft(env, member, id) {

  var check = await ownBracket(env, member, id);

  if (check.response) {
    return check.response;
  }

  var bracket = check.bracket;
  var helperIds = parseIds(bracket.helpers);
  var helpers = [];

  if (helperIds.length) {
    var rows = await env.BRACKET_DB.prepare(
      "SELECT member_id AS id, nickname FROM members WHERE member_id IN (SELECT value FROM json_each(?))"
    ).bind(JSON.stringify(helperIds)).all();
    helpers = rows.results || [];
  }

  return jsonResponse({
    success: true,
    data: {
      id: bracket.id,
      share_code: bracket.share_code,
      title: bracket.title,
      event_date: bracket.event_date,
      format: bracket.format,
      status: bracket.status,
      participants: parseNames(bracket.participants),
      helpers: helpers
    }
  });
}


function cleanDraft(body) {

  var title = cleanText(body.title).slice(0, 60);
  var date = cleanText(body.event_date);
  var format = FORMATS.indexOf(body.format) !== -1 ? body.format : "champ";
  var names = [];
  var seen = {};

  (Array.isArray(body.participants) ? body.participants : []).forEach(function (raw) {

    var name = cleanText(raw).slice(0, 40);

    if (name && !/[<>]/.test(name) && !seen[name.toLowerCase()] && names.length < MAX_PARTICIPANTS) {
      seen[name.toLowerCase()] = true;
      names.push(name);
    }
  });

  var helpers = [];

  (Array.isArray(body.helpers) ? body.helpers : []).forEach(function (id) {
    if (isPositiveInteger(id) && helpers.indexOf(Number(id)) === -1) {
      helpers.push(Number(id));
    }
  });

  return {
    title: title,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    format: format,
    names: names,
    helpers: helpers
  };
}


async function saveDraft(body, env, member, id) {

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var draft = cleanDraft(body);

  if (!draft.title) {
    return errorResponse("REQUIRED", 400, { field: "title" });
  }

  if (draft.helpers.length > MAX_HELPERS) {
    return errorResponse("TOO_MANY_HELPERS", 400);
  }

  /* 協助者要是官網的會員，並同步到賽程資料庫的會員主檔 */
  for (var i = 0; i < draft.helpers.length; i++) {
    await syncMemberToBracket(env, draft.helpers[i]);
  }

  if (draft.helpers.length) {

    var known = await env.BRACKET_DB.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND member_id IN (SELECT value FROM json_each(?))"
    ).bind(JSON.stringify(draft.helpers)).first();

    if (!known || Number(known.n) !== draft.helpers.length) {
      return errorResponse("HELPER_NOT_FOUND", 400);
    }
  }

  if (id === null) {

    var count = await env.BRACKET_DB.prepare("SELECT COUNT(*) AS n FROM brackets WHERE owner_id = ?").bind(member.id).first();

    if (count && Number(count.n) >= MAX_BRACKETS) {
      return errorResponse("LIMIT_REACHED", 409, { limit: MAX_BRACKETS });
    }

    var created = await env.BRACKET_DB.prepare(
      "INSERT INTO brackets (share_code, owner_id, title, event_date, format, participants, helpers) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(randomCode(10), member.id, draft.title, draft.date, draft.format,
      JSON.stringify(draft.names), JSON.stringify(draft.helpers)).run();

    return jsonResponse({ success: true, id: created.meta.last_row_id }, 201);
  }

  var check = await ownBracket(env, member, id);

  if (check.response) {
    return check.response;
  }

  /* 對戰表建立後，只能改名稱、日期、協助者；參賽者和賽制不能再改 */
  if (check.bracket.status === "draft") {
    await env.BRACKET_DB.prepare(
      "UPDATE brackets SET title = ?, event_date = ?, format = ?, participants = ?, helpers = ?, " +
      "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(draft.title, draft.date, draft.format, JSON.stringify(draft.names), JSON.stringify(draft.helpers), id).run();
  } else {
    await env.BRACKET_DB.prepare(
      "UPDATE brackets SET title = ?, event_date = ?, helpers = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(draft.title, draft.date, JSON.stringify(draft.helpers), id).run();
  }

  return jsonResponse({ success: true, id: id });
}


async function deleteBracket(env, member, id) {

  var check = await ownBracket(env, member, id);

  if (check.response) {
    return check.response;
  }

  /* 只刪這筆賽程和它的對戰表，不會動到會員資料 */
  await env.BRACKET_DB.batch([
    env.BRACKET_DB.prepare("DELETE FROM bracket_matches WHERE bracket_id = ?").bind(id),
    env.BRACKET_DB.prepare("DELETE FROM brackets WHERE id = ?").bind(id)
  ]);

  return jsonResponse({ success: true });
}


async function startBracket(body, env, member, id) {

  /* 開賽前先存一次畫面上最新的內容 */
  if (body && body.title) {

    var saved = await saveDraft(body, env, member, id);

    if (saved.status >= 400) {
      return saved;
    }
  }

  var check = await ownBracket(env, member, id);

  if (check.response) {
    return check.response;
  }

  var bracket = check.bracket;

  if (bracket.status !== "draft") {
    return errorResponse("ALREADY_STARTED", 409);
  }

  var names = parseNames(bracket.participants);

  if (names.length < 2) {
    return errorResponse("NEED_PLAYERS", 400);
  }

  var built = buildMatches(names, bracket.format);
  var statement = env.BRACKET_DB.prepare(
    "INSERT INTO bracket_matches (bracket_id, code, round, slot, sort, title, a_name, b_name, a_from, b_from) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  var statements = [env.BRACKET_DB.prepare("DELETE FROM bracket_matches WHERE bracket_id = ?").bind(id)];

  built.matches.forEach(function (m) {
    statements.push(statement.bind(id, m.code, m.round, m.slot, m.sort, m.title, m.a_name, m.b_name, m.a_from, m.b_from));
  });

  statements.push(env.BRACKET_DB.prepare(
    "UPDATE brackets SET status = 'live', started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(taiwanNow(), id));

  await env.BRACKET_DB.batch(statements);

  return jsonResponse({ success: true, share_code: bracket.share_code });
}


async function setResult(body, env, member, id) {

  body = body || {};

  var bracket = await env.BRACKET_DB.prepare("SELECT * FROM brackets WHERE id = ?").bind(id).first();

  if (!bracket || bracket.status === "draft") {
    return errorResponse("NOT_FOUND", 404);
  }

  if (bracket.owner_id !== member.id && parseIds(bracket.helpers).indexOf(member.id) === -1) {
    return errorResponse("FORBIDDEN", 403);
  }

  var winner = body.winner === "a" || body.winner === "b" ? body.winner : null;
  var code = cleanText(body.code);

  var rows = (await env.BRACKET_DB.prepare("SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY sort")
    .bind(id).all()).results || [];

  var resolved = resolveMatches(rows);
  var target = resolved.list.filter(function (m) { return m.code === code; })[0];

  if (!target || (target.state !== "live" && target.state !== "done")) {
    return errorResponse("NOT_PLAYABLE", 409);
  }

  /* 改掉或取消已經有結果的場次：後面接著的場次如果已經打完，要先取消後面的 */
  if (target.state === "done" && winner !== target.winner) {

    var blocked = resolved.list.some(function (m) {
      var fromThis = (m.a_from && m.a_from.slice(2) === code) || (m.b_from && m.b_from.slice(2) === code);
      return fromThis && m.state === "done";
    });

    if (blocked) {
      return errorResponse("DEPENDENT_DONE", 409);
    }
  }

  await env.BRACKET_DB.prepare(
    "UPDATE bracket_matches SET winner = ?, updated_at = ? WHERE bracket_id = ? AND code = ?"
  ).bind(winner, taiwanNow(), id, code).run();

  /* 全部打完就標成已結束，並記下冠軍；取消結果則回到比賽中 */
  rows = (await env.BRACKET_DB.prepare("SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY sort")
    .bind(id).all()).results || [];

  resolved = resolveMatches(rows);

  var finished = resolved.list.every(function (m) { return m.state === "done" || m.state === "bye"; });
  var champ = resolved.map["R" + mainRounds(rows) + "-1"];
  var champName = finished && champ && champ.win && champ.win.name ? champ.win.name : null;

  await env.BRACKET_DB.prepare(
    "UPDATE brackets SET status = ?, champion = ?, finished_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(finished ? "done" : "live", champName, finished ? taiwanNow() : null, id).run();

  return jsonResponse({ success: true });
}
