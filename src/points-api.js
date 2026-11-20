/* =========================================================
   OURSPACE
   集點卡（後台）

   頁面權限 point_cards
     GET    /api/referee/points/cards           集點卡列表（含持卡人數、發出點數）
     POST   /api/referee/points/cards           新增集點卡
     PUT    /api/referee/points/cards/:id       修改集點卡
     GET    /api/referee/points/members?q=      搜尋會員（暱稱、電話、會員編號）
     GET    /api/referee/points/ledger?card_id=&user_id=   最近 100 筆點數紀錄
     POST   /api/referee/points/adjust          手動加扣點 { card_id, user_id, delta, reason }
     DELETE /api/referee/points/ledger/:id      刪除一筆紀錄（點數會跟著回復）

     GET    /api/referee/points/bracket/:code   讀取對戰表：每個 Round 有上場的人，以及對到哪位會員
     POST   /api/referee/points/award           依對戰表的 Round 批次發點
            { code, card_id, rounds: [{ round, points }] }
            同一位會員、同一張對戰表、同一個 Round、同一張卡只會發一次
========================================================= */

import { jsonResponse, errorResponse, parseJsonBody, cleanText, isPositiveInteger, taiwanNow } from "./util.js";
import { requireStaff, writeAuditLog } from "./auth.js";
import { resolveMatches, bracketMemberMap, bracketGuestMap } from "./bracket-api.js";
import { normName, stripNumber } from "./checkin-api.js";


function toInt(value, min, max) {
  var number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}


function cleanColor(value) {
  var text = cleanText(value);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : null;
}


function cleanImage(value) {
  var text = cleanText(value).slice(0, 500);
  return /^(https:\/\/|\/)[^\s<>"']+$/.test(text) ? text : null;
}


export async function handlePointsApi(request, url, env) {

  var parts = url.pathname.split("/").filter(Boolean).slice(3);

  var auth = await requireStaff(request, env, ["point_cards"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;

  try {

    if (parts[0] === "bracket" && parts[1] && method === "GET") {
      return bracketPreview(env, parts[1], toInt(url.searchParams.get("event_id"), 1, 1e9));
    }

    if (parts[0] === "events" && method === "GET") {
      return recentEvents(env);
    }

    if (parts[0] === "award" && method === "POST") {
      return awardRounds(request, env, staff);
    }

    if (parts[0] === "cards" && parts.length === 1 && method === "GET") {
      return listCards(env);
    }

    if (parts[0] === "cards" && parts.length === 1 && method === "POST") {
      return saveCard(request, env, staff, null);
    }

    if (parts[0] === "cards" && isPositiveInteger(parts[1]) && method === "PUT") {
      return saveCard(request, env, staff, Number(parts[1]));
    }

    if (parts[0] === "members" && method === "GET") {
      return searchMembers(url, env);
    }

    if (parts[0] === "ledger" && parts.length === 1 && method === "GET") {
      return listLedger(url, env);
    }

    if (parts[0] === "ledger" && isPositiveInteger(parts[1]) && method === "DELETE") {
      return deleteLedger(env, staff, Number(parts[1]));
    }

    if (parts[0] === "adjust" && method === "POST") {
      return adjust(request, env, staff);
    }

  } catch (error) {
    if (String(error && error.message).indexOf("no such table") !== -1) {
      return errorResponse("POINTS_NOT_READY", 500);
    }
    throw error;
  }

  return errorResponse("API_NOT_FOUND", 404);
}


async function listCards(env) {

  var rows = await env.DB.prepare(
    "SELECT c.*, " +
    "(SELECT COUNT(DISTINCT COALESCE('u' || l.user_id, 'p' || l.player_id)) FROM point_ledger l WHERE l.card_id = c.id) AS holders, " +
    "(SELECT COALESCE(SUM(CASE WHEN l.delta > 0 THEN l.delta ELSE 0 END), 0) FROM point_ledger l WHERE l.card_id = c.id) AS issued, " +
    "(SELECT COALESCE(SUM(CASE WHEN l.delta < 0 THEN -l.delta ELSE 0 END), 0) FROM point_ledger l WHERE l.card_id = c.id) AS used " +
    "FROM point_cards c ORDER BY c.status = 'active' DESC, c.sort_order, c.id"
  ).all();

  return jsonResponse({ success: true, data: rows.results || [] });
}


async function saveCard(request, env, staff, id) {

  var body = (await parseJsonBody(request)) || {};
  var name = cleanText(body.name).slice(0, 40);

  if (!name) {
    return errorResponse("REQUIRED", 400);
  }

  var values = [
    name,
    cleanText(body.description).slice(0, 300) || null,
    cleanColor(body.color),
    toInt(body.stamp_goal, 1, 50),
    cleanImage(body.image_url),
    body.status === "inactive" ? "inactive" : "active",
    toInt(body.sort_order, 0, 9999) === null ? 100 : toInt(body.sort_order, 0, 9999)
  ];

  if (id) {
    var update = env.DB.prepare(
      "UPDATE point_cards SET name = ?, description = ?, color = ?, stamp_goal = ?, image_url = ?, status = ?, sort_order = ? WHERE id = ?"
    );
    await update.bind.apply(update, values.concat([id])).run();
  } else {
    var insert = env.DB.prepare(
      "INSERT INTO point_cards (name, description, color, stamp_goal, image_url, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    id = (await insert.bind.apply(insert, values).run()).meta.last_row_id;
  }

  await writeAuditLog(env, staff, "save", "point_cards", id, { name: name });

  return jsonResponse({ success: true, id: id });
}


async function searchMembers(url, env) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);

  if (!keyword) {
    return jsonResponse({ success: true, data: [] });
  }

  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";
  var digits = keyword.replace(/\D/g, "");
  var memberNo = /^w?\d{1,7}$/i.test(keyword) ? Number(digits) : 0;

  var rows = await env.DB.prepare(
    "SELECT u.id, u.nickname, u.line_name, t.team_name FROM users u LEFT JOIN teams t ON t.id = u.primary_team_id " +
    "WHERE u.status = 'active' AND (u.nickname LIKE ? ESCAPE '\\' OR u.line_name LIKE ? ESCAPE '\\'" +
    (digits.length >= 3 ? " OR replace(replace(u.phone, '-', ''), ' ', '') LIKE ?" : "") +
    (memberNo ? " OR u.id = ?" : "") + ") ORDER BY u.nickname LIMIT 20"
  );

  var binds = [like, like];

  if (digits.length >= 3) {
    binds.push("%" + digits + "%");
  }

  if (memberNo) {
    binds.push(memberNo);
  }

  var result = await rows.bind.apply(rows, binds).all();

  return jsonResponse({ success: true, data: result.results || [] });
}


async function listLedger(url, env) {

  var where = [];
  var binds = [];
  var cardId = toInt(url.searchParams.get("card_id"), 1, 1e9);
  var userId = toInt(url.searchParams.get("user_id"), 1, 1e9);

  if (cardId) {
    where.push("l.card_id = ?");
    binds.push(cardId);
  }

  if (userId) {
    where.push("l.user_id = ?");
    binds.push(userId);
  }

  var statement = env.DB.prepare(
    /* 非會員（還沒認領）的點數記在選手資料：名字用選手資料的，標「待認領」 */
    "SELECT l.id, l.card_id, c.name AS card_name, l.user_id, l.player_id, " +
    "COALESCE(u.nickname, NULLIF(p.nickname, ''), p.player_name) AS nickname, " +
    "CASE WHEN l.user_id IS NULL THEN 1 ELSE 0 END AS unclaimed, " +
    "l.delta, l.reason, l.event_id, l.created_by, l.created_at, " +
    "(SELECT COALESCE(SUM(x.delta), 0) FROM point_ledger x WHERE x.card_id = l.card_id AND " +
    " (CASE WHEN l.user_id IS NULL THEN x.player_id = l.player_id AND x.user_id IS NULL ELSE x.user_id = l.user_id END)) AS balance " +
    "FROM point_ledger l LEFT JOIN point_cards c ON c.id = l.card_id LEFT JOIN users u ON u.id = l.user_id " +
    "LEFT JOIN players p ON p.id = l.player_id " +
    (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
    "ORDER BY l.id DESC LIMIT 100"
  );

  var rows = await (binds.length ? statement.bind.apply(statement, binds) : statement).all();

  return jsonResponse({ success: true, data: rows.results || [] });
}


async function adjust(request, env, staff) {

  var body = (await parseJsonBody(request)) || {};
  var cardId = toInt(body.card_id, 1, 1e9);
  var delta = toInt(body.delta, -100000, 100000);
  var reason = cleanText(body.reason).slice(0, 100);

  /* 可以一次選多位會員（user_ids）；舊的單一 user_id 也收 */
  var userIds = (Array.isArray(body.user_ids) ? body.user_ids : [body.user_id]).map(function (v) {
    return toInt(v, 1, 1e9);
  }).filter(function (v, i, list) { return v && list.indexOf(v) === i; }).slice(0, 100);

  if (!cardId || !userIds.length || !delta) {
    return errorResponse("REQUIRED", 400);
  }

  var card = await env.DB.prepare("SELECT id FROM point_cards WHERE id = ?").bind(cardId).first();

  if (!card) {
    return errorResponse("NOT_FOUND", 404);
  }

  var users = (await env.DB.prepare(
    "SELECT u.id, u.nickname, " +
    "(SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l WHERE l.card_id = ? AND l.user_id = u.id) AS balance " +
    "FROM users u WHERE u.id IN (SELECT value FROM json_each(?))"
  ).bind(cardId, JSON.stringify(userIds)).all()).results || [];

  if (users.length !== userIds.length) {
    return errorResponse("NOT_FOUND", 404);
  }

  /* 扣點不能扣到負數：有任何一位不夠扣，整批都不登錄，並列出是誰 */
  if (delta < 0) {
    var short = users.filter(function (u) { return Number(u.balance) + delta < 0; });
    if (short.length) {
      return errorResponse("NOT_ENOUGH_POINTS", 400, { data: { reasons: short.map(function (u) {
        return u.nickname + "（W" + u.id + "）只有 " + u.balance + " 點";
      }) } });
    }
  }

  var now = taiwanNow();
  var by = staff.display_name || String(staff.id);
  var text = reason || (delta > 0 ? "手動加點" : "手動扣點");

  await env.DB.batch(userIds.map(function (userId) {
    return env.DB.prepare(
      "INSERT INTO point_ledger (card_id, user_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(cardId, userId, delta, text, by, now);
  }));

  await writeAuditLog(env, staff, "adjust", "point_ledger", null, { card_id: cardId, user_ids: userIds, delta: delta });

  return jsonResponse({ success: true, count: userIds.length }, 201);
}


async function deleteLedger(env, staff, id) {

  var row = await env.DB.prepare("SELECT * FROM point_ledger WHERE id = ?").bind(id).first();

  if (!row) {
    return errorResponse("NOT_FOUND", 404);
  }

  await env.DB.prepare("DELETE FROM point_ledger WHERE id = ?").bind(id).run();
  await writeAuditLog(env, staff, "delete", "point_ledger", id, { card_id: row.card_id, user_id: row.user_id, delta: row.delta, reason: row.reason });

  return jsonResponse({ success: true });
}


/* =========================================================
   對戰表 → 每個 Round 有上場的人 → 對到會員
   名字比對：先去掉前面的號碼比、再用整個名字比（忽略空白、全形半形、大小寫）
   1. 這張對戰表已經在某個場次的賽後紀錄讀取過 → 用那場的報到名單
   2. 沒有 → 用會員的主要暱稱（同名的會員有兩位以上就不對）
========================================================= */
async function bracketRounds(env, code, eventId) {

  if (!env.BRACKET_DB) {
    return { error: errorResponse("BRACKET_NOT_READY", 503) };
  }

  if (!/^[A-Za-z0-9]{6,20}$/.test(code)) {
    return { error: errorResponse("INVALID_BRACKET", 400) };
  }

  var bracket = await env.BRACKET_DB.prepare("SELECT id, title, event_date FROM brackets WHERE share_code = ?").bind(code).first();

  if (!bracket) {
    return { error: errorResponse("BRACKET_NOT_FOUND", 404) };
  }

  var matchRows = (await env.BRACKET_DB.prepare("SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY sort")
    .bind(bracket.id).all()).results || [];

  var resolved = resolveMatches(matchRows);
  var mainRounds = matchRows.reduce(function (max, m) {
    return m.code.charAt(0) === "R" ? Math.max(max, m.round) : max;
  }, 1);

  /* 對會員的名單：指定的場次 → 賽後紀錄綁定過的場次 → 都沒有就用會員暱稱 */
  var event = null;

  if (eventId) {
    event = await env.DB.prepare("SELECT id, title FROM checkin_events WHERE id = ?").bind(eventId).first();
  }

  if (!event) {
    event = await env.DB.prepare("SELECT id, title FROM checkin_events WHERE bracket_code = ? ORDER BY id DESC LIMIT 1")
      .bind(code).first().catch(function () { return null; });
  }

  var byName = {};

  if (event) {

    var entries = (await env.DB.prepare(
      "SELECT c.id AS entry_id, c.player_id, c.nickname, COALESCE(c.user_id, p.user_id) AS user_id, u.nickname AS member_name FROM checkin_entries c " +
      "LEFT JOIN players p ON p.id = c.player_id " +
      "LEFT JOIN users u ON u.id = COALESCE(c.user_id, p.user_id) WHERE c.event_id = ? AND c.checked_in = 1"
    ).bind(event.id).all()).results || [];

    entries.forEach(function (e) {
      byName[normName(e.nickname)] = e.user_id
        ? { user_id: e.user_id, member_name: e.member_name }
        : { guest: true, entry_id: e.entry_id, player_id: e.player_id || null, nickname: e.nickname };
    });

  } else {

    var users = (await env.DB.prepare("SELECT id, nickname FROM users WHERE status = 'active'").all()).results || [];
    var count = {};

    users.forEach(function (u) {
      var key = normName(u.nickname);
      count[key] = (count[key] || 0) + 1;
      byName[key] = { user_id: u.id, member_name: u.nickname };
    });

    Object.keys(count).forEach(function (key) {
      if (count[key] > 1) {
        byName[key] = { ambiguous: true };
      }
    });
  }

  /* 從報到名單貼上時帶的會員編號（最準）→ 報到名單的名字 → 會員暱稱 */
  var tagged = await bracketMemberMap(env, bracket.id);
  var taggedIds = Object.keys(tagged).map(function (n) { return tagged[n]; });
  var taggedNames = {};

  if (taggedIds.length) {
    var named = await env.DB.prepare("SELECT id, nickname FROM users WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(taggedIds)).all();
    (named.results || []).forEach(function (u) { taggedNames[u.id] = u.nickname; });
  }

  /* 之前批次發點時，幫非會員建立的選手資料（下次發點用同一筆） */
  var guestMap = await bracketGuestMap(env, bracket.id);

  function match(name) {
    if (tagged[name]) {
      return { user_id: tagged[name], member_name: taggedNames[tagged[name]] || null };
    }
    var found = byName[stripNumber(name)] || byName[normName(name)] || null;
    if (found && found.guest && !found.player_id && guestMap[name]) {
      found = Object.assign({}, found, { player_id: guestMap[name] });
    }
    if (!found && guestMap[name]) {
      found = { guest: true, entry_id: null, player_id: guestMap[name], nickname: plainName(name) };
    }
    return found;
  }

  var rounds = [];
  var byRound = {};

  resolved.list.forEach(function (m) {

    if (m.state !== "live" && m.state !== "done") {
      return;
    }

    var isMain = m.code.charAt(0) === "R";
    var round = isMain ? m.round : mainRounds + 1;

    if (!byRound[round]) {
      byRound[round] = { round: round, label: isMain ? "Round " + m.round : "名次賽", players: [], seen: {} };
      rounds.push(byRound[round]);
    }

    ["a", "b"].forEach(function (side) {

      var name = m[side];

      if (!name || m[side + "_state"] !== "ok" || byRound[round].seen[name]) {
        return;
      }

      byRound[round].seen[name] = true;

      var found = match(name) || {};

      byRound[round].players.push({
        name: name,
        user_id: found.user_id || null,
        member_name: found.member_name || null,
        /* 非會員（報到名單裡的、或直接在對戰表新增的）：點數記在他的選手資料，等之後認領 */
        entry_id: found.guest ? found.entry_id || null : null,
        entry_player_id: found.guest ? found.player_id || null : null,
        guest_name: !found.user_id && !found.ambiguous ? (found.nickname || plainName(name)) : null,
        note: found.ambiguous ? "同名會員不只一位，沒有發"
          : found.user_id ? ""
          : found.guest && found.entry_id ? "非會員：記在選手資料，等認領"
          : found.guest ? "非會員：已有選手資料，等認領"
          : "不在報到名單：" + (event ? "發點時加進報到名單、" : "") + "建立選手資料「" + plainName(name) + "」，等認領"
      });
    });
  });

  rounds.sort(function (x, y) { return x.round - y.round; });
  rounds.forEach(function (r) { delete r.seen; });

  return {
    bracket: { id: bracket.id, code: code, title: bracket.title, event_date: bracket.event_date },
    event: event ? { id: event.id, title: event.title } : null,
    rounds: rounds
  };
}


/* 最近 90 天的場次（給批次發點選「用哪一場的報到名單對會員」） */
async function recentEvents(env) {

  var rows = await env.DB.prepare(
    "SELECT e.id, e.title, e.event_date, e.start_time, " +
    "(SELECT COUNT(*) FROM checkin_entries c WHERE c.event_id = e.id AND c.checked_in = 1) AS checked " +
    "FROM checkin_events e WHERE e.event_date >= date('now', '+8 hours', '-90 days') " +
    "ORDER BY e.event_date DESC, e.start_time DESC LIMIT 60"
  ).all();

  return jsonResponse({ success: true, data: rows.results || [] });
}


async function bracketPreview(env, code, eventId) {

  var data = await bracketRounds(env, code, eventId);

  if (data.error) {
    return data.error;
  }

  return jsonResponse({ success: true, data: data });
}


async function awardRounds(request, env, staff) {

  var body = (await parseJsonBody(request)) || {};
  var code = cleanText(body.code);
  var cardId = toInt(body.card_id, 1, 1e9);
  var picks = (Array.isArray(body.rounds) ? body.rounds : []).map(function (r) {
    return { round: toInt(r && r.round, 1, 99), points: toInt(r && r.points, 1, 10000) };
  }).filter(function (r) { return r.round && r.points; });

  if (!code || !cardId || !picks.length) {
    return errorResponse("REQUIRED", 400);
  }

  var card = await env.DB.prepare("SELECT id FROM point_cards WHERE id = ? AND status = 'active'").bind(cardId).first();

  if (!card) {
    return errorResponse("NOT_FOUND", 404);
  }

  var data = await bracketRounds(env, code, toInt(body.event_id, 1, 1e9));

  if (data.error) {
    return data.error;
  }

  var given = 0;
  var guests = 0;
  var skipped = 0;
  var unmatched = 0;
  var guestPlayers = {};
  var now = taiwanNow();
  var by = staff.display_name || String(staff.id);
  var title = data.bracket.title || "對戰表";

  for (var i = 0; i < picks.length; i++) {

    var pick = picks[i];
    var round = data.rounds.filter(function (r) { return r.round === pick.round; })[0];

    if (!round) {
      continue;
    }

    var seen = {};

    for (var k = 0; k < round.players.length; k++) {

      var p = round.players[k];
      var key = "bracket:" + code + ":R" + round.round;
      var reason = title + " " + round.label;
      var eventId = data.event ? data.event.id : null;

      /* 會員：記在會員身上 */
      if (p.user_id) {

        if (seen["u" + p.user_id]) {
          continue;
        }

        seen["u" + p.user_id] = true;

        var exists = await env.DB.prepare(
          "SELECT id FROM point_ledger WHERE card_id = ? AND user_id = ? AND source_key = ? LIMIT 1"
        ).bind(cardId, p.user_id, key).first();

        if (exists) {
          skipped++;
          continue;
        }

        await env.DB.prepare(
          "INSERT INTO point_ledger (card_id, user_id, delta, reason, event_id, source_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(cardId, p.user_id, pick.points, reason, eventId, key, by, now).run();

        given++;
        continue;
      }

      /* 非會員（在報到名單裡）：跟封存上位紀錄一樣，記在選手資料（沒有就建立），參賽紀錄也會連上，之後等認領 */
      if (p.guest_name) {

        var cacheKey = "n" + p.name;
        var playerId = guestPlayers[cacheKey] || await guestPlayer(env, data.bracket.id, p, eventId, now);
        guestPlayers[cacheKey] = playerId;

        if (!playerId || seen["p" + playerId]) {
          continue;
        }

        seen["p" + playerId] = true;

        var owner = await env.DB.prepare("SELECT user_id FROM players WHERE id = ?").bind(playerId).first();
        var ownerId = owner && owner.user_id ? owner.user_id : null;

        var dup = await env.DB.prepare(
          "SELECT id FROM point_ledger WHERE card_id = ? AND source_key = ? AND (player_id = ? OR (? IS NOT NULL AND user_id = ?)) LIMIT 1"
        ).bind(cardId, key, playerId, ownerId, ownerId).first();

        if (dup) {
          skipped++;
          continue;
        }

        await env.DB.prepare(
          "INSERT INTO point_ledger (card_id, user_id, player_id, delta, reason, event_id, source_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(cardId, ownerId, playerId, pick.points, reason, eventId, key, by, now).run();

        given++;
        guests++;
        continue;
      }

      unmatched++;
    }
  }

  await writeAuditLog(env, staff, "award_rounds", "point_ledger", null, { code: code, card_id: cardId, given: given });

  return jsonResponse({ success: true, given: given, guests: guests, skipped: skipped, unmatched: unmatched });
}


/* 對戰表上的名字 → 選手資料用的名字：去掉前面的號碼（33- ）和裁判記號 ㊣ */
function plainName(name) {
  return String(name || "").replace(/^\s*\d+\s*[-.、:：_]+\s*/, "").replace(/\s*㊣\s*/g, " ").trim() || String(name || "").trim();
}


/* 非會員的選手資料（規則：不用同名的舊資料，一律另外建立一筆，之後等認領；一年沒認領會自動清除）
   - 報名或之前發點已經有選手資料 → 用那一筆
   - 沒有 → 建立一筆（記是哪一場建立的）
   - 有選場次：報名連上這筆選手資料；不在報到名單的（直接在對戰表新增的）加進報到名單、標已報到，參賽紀錄才會有
   - 記在 bracket_members，下次發點用同一筆 */
async function guestPlayer(env, bracketId, p, eventId, now) {

  var name = p.guest_name;
  var entryId = p.entry_id && eventId ? p.entry_id : null;
  var playerId = p.entry_player_id || null;

  /* 不在報到名單：先看這場有沒有同名的報名（可能還沒報到） */
  if (!entryId && eventId) {
    var same = await env.DB.prepare("SELECT id, player_id, user_id FROM checkin_entries WHERE event_id = ? AND nickname = ? LIMIT 1")
      .bind(eventId, name).first();
    if (same && !same.user_id) {
      entryId = same.id;
      playerId = playerId || same.player_id || null;
    }
  }

  if (!playerId) {
    var created = await env.DB.prepare(
      "INSERT INTO players (user_id, player_name, nickname, team_id, created_by_event) VALUES (NULL, ?, ?, NULL, ?)"
    ).bind(name, name, eventId || null).run();
    playerId = created.meta.last_row_id;
  }

  if (eventId) {
    if (entryId) {
      await env.DB.prepare(
        "UPDATE checkin_entries SET player_id = COALESCE(player_id, ?), checked_in = 1, checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ?"
      ).bind(playerId, now, entryId).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO checkin_entries (event_id, nickname, player_id, checked_in, checked_in_at, source) VALUES (?, ?, ?, 1, ?, 'bracket')"
      ).bind(eventId, name, playerId, now).run();
    }
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO bracket_members (bracket_id, name, user_id, player_id) VALUES (?, ?, NULL, ?)"
  ).bind(bracketId, p.name, playerId).run().catch(function () {});

  return playerId;
}
