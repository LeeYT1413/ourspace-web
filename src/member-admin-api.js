/* =========================================================
   OURSPACE
   後台：審核中心、會員管理（/api/referee/members/*）

   審核中心（頁面 review）
     GET  /api/referee/members/review                  待審核：選手認領、戰隊修改
     GET  /api/referee/members/review/history          已處理（最近 50 筆）
     POST /api/referee/members/claims/:id/approve
     POST /api/referee/members/claims/:id/reject       body: { note }
     POST /api/referee/members/team-edits/:id/approve
     POST /api/referee/members/team-edits/:id/reject   body: { note }

   會員管理（頁面 members）
     GET  /api/referee/members/list?q=&filter=all|new|off
     GET  /api/referee/members/:id
     POST /api/referee/members/:id/status              body: { status: active | disabled }
     POST /api/referee/members/:id/captain             body: { team_id }   設為隊長

   會員的戰隊暱稱 / 選手資料整合（只有系統管理員）
     GET  /api/referee/members/integration?q=          還沒連到會員的選手資料 + 建議的會員
     POST /api/referee/members/:id/players/link        body: { player_id }   幫會員認領（不用審核）
     POST /api/referee/members/:id/players/unlink      body: { player_id }
     POST /api/referee/members/:id/players/add         body: { team_id, nickname }
     POST /api/referee/members/:id/players/:pid/nickname   body: { nickname }

   完整電話只有系統管理員、管理員看得到，其他人只看末三碼
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow
} from "./util.js";

import { requireStaff, writeAuditLog, canUsePage, MANAGER_ROLES } from "./auth.js";
import { syncMemberToErp, ensurePlayer, validName } from "./member-api.js";
import { markRankingDirty } from "./ranking.js";


function sysadminOnly(staff) {
  return staff.role === "sysadmin" ? null : errorResponse("FORBIDDEN", 403);
}


function maskPhone(phone) {
  var digits = String(phone || "").replace(/\D/g, "");
  return digits ? "末三碼 " + digits.slice(-3) : "";
}


export async function handleMemberAdminApi(request, url, env) {

  var auth = await requireStaff(request, env, ["review", "members"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var parts = url.pathname.split("/").filter(Boolean).slice(3);
  var method = request.method;

  function need(page) {
    return canUsePage(staff, page) ? null : errorResponse("FORBIDDEN", 403);
  }

  if (parts[0] === "review" && parts.length === 1 && method === "GET") {
    return need("review") || pending(env);
  }

  if (parts[0] === "review" && parts[1] === "history" && method === "GET") {
    return need("review") || history(env);
  }

  if ((parts[0] === "claims" || parts[0] === "team-edits") && isPositiveInteger(parts[1]) &&
      (parts[2] === "approve" || parts[2] === "reject") && method === "POST") {
    return need("review") || review(request, env, staff, parts[0], Number(parts[1]), parts[2] === "approve");
  }

  if (parts[0] === "integration" && method === "GET") {
    return sysadminOnly(staff) || integration(url, env);
  }

  if (parts[0] === "multi" && method === "GET") {
    return sysadminOnly(staff) || multiPlayers(env);
  }

  if (parts[0] === "list" && method === "GET") {
    return need("members") || listMembers(url, env, staff);
  }

  if (isPositiveInteger(parts[0])) {

    var id = Number(parts[0]);

    if (parts.length === 1 && method === "GET") {
      return need("members") || memberDetail(env, staff, id);
    }

    if (parts[1] === "status" && method === "POST") {
      return need("members") || setStatus(request, env, staff, id);
    }

    if (parts[1] === "captain" && method === "POST") {
      return need("members") || setCaptain(request, env, staff, id);
    }

    /* 系統管理員：手動補登參賽和上位紀錄、改隊內暱稱 */
    if (parts[1] === "records" && method === "GET") {
      return sysadminOnly(staff) || memberRecords(env, id);
    }

    if (parts[1] === "games" && method === "POST" && parts.length === 2) {
      return sysadminOnly(staff) || addManualGame(request, env, staff, id);
    }

    if (parts[1] === "games" && method === "DELETE" && isPositiveInteger(parts[2])) {
      return sysadminOnly(staff) || deleteManualGame(env, staff, id, Number(parts[2]));
    }

    if (parts[1] === "placements" && method === "POST" && parts.length === 2) {
      return sysadminOnly(staff) || addManualPlacement(request, env, staff, id);
    }

    if (parts[1] === "placements" && method === "DELETE" && isPositiveInteger(parts[2])) {
      return sysadminOnly(staff) || deleteMemberPlacement(env, staff, id, Number(parts[2]));
    }

    if (parts[1] === "teams" && isPositiveInteger(parts[2]) && parts[3] === "nickname" && method === "POST") {
      return sysadminOnly(staff) || setMemberTeamNickname(request, env, staff, id, Number(parts[2]));
    }

    if (parts[1] === "players" && method === "POST") {

      var denied = sysadminOnly(staff);

      if (denied) {
        return denied;
      }

      if (parts[2] === "link" || parts[2] === "unlink") {
        return linkPlayer(request, env, staff, id, parts[2] === "link");
      }

      if (parts[2] === "add") {
        return addIdentity(request, env, staff, id);
      }

      if (parts[2] === "merge") {
        return mergeRequest(request, env, staff, id);
      }

      if (parts[2] === "main") {
        return setMain(request, env, staff, id);
      }

      if (isPositiveInteger(parts[2]) && parts[3] === "nickname") {
        return renameIdentity(request, env, staff, id, Number(parts[2]));
      }
    }
  }

  return null;
}


/* =========================================================
   審核中心
========================================================= */

var CLAIM_SELECT =
  "SELECT c.id, c.status, c.note, c.created_at, c.reviewed_at, c.reviewed_by, " +
  "u.id AS user_id, u.nickname, u.phone, " +
  "p.id AS player_id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, p.user_id AS player_user_id, " +
  "t.team_name, (SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count " +
  "FROM player_claims c INNER JOIN users u ON u.id = c.user_id " +
  "INNER JOIN players p ON p.id = c.player_id LEFT JOIN teams t ON t.id = p.team_id ";

var EDIT_SELECT =
  "SELECT r.id, r.status, r.note, r.description, r.logo_image_id, r.created_at, r.reviewed_at, r.reviewed_by, " +
  "t.id AS team_id, t.team_name, t.description AS old_description, t.team_logo_url AS old_logo, " +
  "u.nickname AS captain_name " +
  "FROM team_edit_requests r INNER JOIN teams t ON t.id = r.team_id INNER JOIN users u ON u.id = r.user_id ";


function claimRow(row) {
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    member: row.nickname,
    phone_tail: maskPhone(row.phone),
    player: row.player_name,
    team_name: row.team_name,
    upper_count: row.upper_count,
    linked_other: !!row.player_user_id && row.player_user_id !== row.user_id
  };
}


function editRow(row) {
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    team_name: row.team_name,
    captain: row.captain_name,
    old_description: row.old_description,
    old_logo: row.old_logo,
    description: row.description,
    logo_url: row.logo_image_id ? "/api/checkin/images/" + row.logo_image_id : null
  };
}


async function pending(env) {

  var results = await env.DB.batch([
    env.DB.prepare(CLAIM_SELECT + "WHERE c.status = 'pending' ORDER BY c.id"),
    env.DB.prepare(EDIT_SELECT + "WHERE r.status = 'pending' ORDER BY r.id")
  ]);

  return jsonResponse({
    success: true,
    claims: (results[0].results || []).map(claimRow),
    edits: (results[1].results || []).map(editRow)
  });
}


async function history(env) {

  var results = await env.DB.batch([
    env.DB.prepare(CLAIM_SELECT + "WHERE c.status != 'pending' ORDER BY c.reviewed_at DESC LIMIT 25"),
    env.DB.prepare(EDIT_SELECT + "WHERE r.status != 'pending' ORDER BY r.reviewed_at DESC LIMIT 25")
  ]);

  var list = (results[0].results || []).map(function (row) {
    var item = claimRow(row);
    item.kind = "claim";
    item.by = row.reviewed_by;
    return item;
  }).concat((results[1].results || []).map(function (row) {
    var item = editRow(row);
    item.kind = "edit";
    item.by = row.reviewed_by;
    return item;
  }));

  list.sort(function (a, b) {
    return String(b.reviewed_at || "").localeCompare(String(a.reviewed_at || ""));
  });

  return jsonResponse({ success: true, data: list.slice(0, 50) });
}


async function review(request, env, staff, kind, id, approve) {

  var body = (await parseJsonBody(request)) || {};
  var note = cleanText(body.note).slice(0, 200) || null;
  var by = staff.display_name || String(staff.id);
  var now = taiwanNow();

  if (kind === "claims") {

    var claim = await env.DB.prepare("SELECT * FROM player_claims WHERE id = ? AND status = 'pending'")
      .bind(id)
      .first();

    if (!claim) {
      return errorResponse("NOT_FOUND", 404);
    }

    var statements = [
      env.DB.prepare(
        "UPDATE player_claims SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
      ).bind(approve ? "approved" : "rejected", note, by, now, id)
    ];

    if (approve) {

      /* 綁定到會員；同一筆選手資料的其他待審申請一起婉拒 */
      statements.push(
        env.DB.prepare("UPDATE players SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(claim.user_id, claim.player_id)
      );

      statements.push(
        env.DB.prepare(
          "UPDATE player_claims SET status = 'rejected', note = '已由其他會員認領', reviewed_by = ?, reviewed_at = ? " +
          "WHERE player_id = ? AND status = 'pending' AND id != ?"
        ).bind(by, now, claim.player_id, id)
      );

      /* 選手資料所屬的戰隊，會員也一起成為隊員 */
      statements.push(
        env.DB.prepare(
          "INSERT INTO member_teams (user_id, team_id, status, approved_at) " +
          "SELECT ?, team_id, 'active', ? FROM players WHERE id = ? AND team_id IS NOT NULL " +
          "ON CONFLICT(user_id, team_id) DO UPDATE SET status = 'active', approved_at = excluded.approved_at"
        ).bind(claim.user_id, now, claim.player_id)
      );

      /* 這位會員以前的報名，名字相同、還沒綁選手的，一起補上 */
      statements.push(
        env.DB.prepare(
          "UPDATE checkin_entries SET player_id = ? WHERE user_id = ? AND player_id IS NULL"
        ).bind(claim.player_id, claim.user_id)
      );
    }

    await env.DB.batch(statements);

    if (approve) {
      /* 同戰隊已經有暱稱的，紀錄合併過去、刪掉這筆選手資料 */
      await attachPlayer(env, claim.user_id, claim.player_id);
      await markRankingDirty(env);
    }

    await writeAuditLog(env, staff, approve ? "approve" : "reject", "player_claims", id, null);

    return jsonResponse({ success: true });
  }

  var edit = await env.DB.prepare("SELECT * FROM team_edit_requests WHERE id = ? AND status = 'pending'")
    .bind(id)
    .first();

  if (!edit) {
    return errorResponse("NOT_FOUND", 404);
  }

  var editStatements = [
    env.DB.prepare(
      "UPDATE team_edit_requests SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
    ).bind(approve ? "approved" : "rejected", note, by, now, id)
  ];

  if (approve) {
    editStatements.push(
      env.DB.prepare(
        "UPDATE teams SET description = COALESCE(?, description), " +
        "team_logo_url = COALESCE(?, team_logo_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(edit.description, edit.logo_image_id ? "/api/checkin/images/" + edit.logo_image_id : null, edit.team_id)
    );
  }

  await env.DB.batch(editStatements);
  await writeAuditLog(env, staff, approve ? "approve" : "reject", "team_edit_requests", id, null);

  return jsonResponse({ success: true });
}


/* =========================================================
   會員管理
========================================================= */

async function listMembers(url, env, staff) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);
  var filter = url.searchParams.get("filter") || "all";
  var full = MANAGER_ROLES.indexOf(staff.role) !== -1;
  var where = ["u.line_user_id IS NOT NULL"];
  var binds = [];

  if (filter === "new") {
    where.push("u.joined_at >= date('now', '+8 hours', 'start of month')");
  } else if (filter === "off") {
    where.push("u.status != 'active'");
  }

  if (keyword) {

    var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";
    var digits = keyword.replace(/\D/g, "");

    /* 會員編號：W12 或 12 */
    var memberNo = /^w?\d{1,7}$/i.test(keyword) ? Number(keyword.replace(/\D/g, "")) : 0;

    where.push(
      "(u.nickname LIKE ? ESCAPE '\\' OR u.line_name LIKE ? ESCAPE '\\' OR t.team_name LIKE ? ESCAPE '\\'" +
      (digits.length >= 3 ? " OR replace(replace(u.phone, '-', ''), ' ', '') LIKE ?" : "") +
      (memberNo ? " OR u.id = ?" : "") + ")"
    );

    binds.push(like, like, like);

    if (digits.length >= 3) {
      binds.push("%" + digits + "%");
    }

    if (memberNo) {
      binds.push(memberNo);
    }
  }

  var statement = env.DB.prepare(
    "SELECT u.id, u.nickname, u.line_name, u.avatar_url, u.phone, u.status, u.joined_at, t.team_name, " +
    "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    " WHERE (c.user_id = u.id OR c.player_id IN (SELECT id FROM players WHERE user_id = u.id)) " +
    " AND c.checked_in = 1 AND e.archived_at IS NOT NULL) + " +
    "(SELECT COUNT(*) FROM manual_games g WHERE g.user_id = u.id) AS games " +
    "FROM users u LEFT JOIN teams t ON t.id = u.primary_team_id " +
    "WHERE " + where.join(" AND ") + " ORDER BY u.id DESC LIMIT 200"
  );

  var result = await (binds.length ? statement.bind.apply(statement, binds) : statement).all();

  var total = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE line_user_id IS NOT NULL").first();

  return jsonResponse({
    success: true,
    total: total ? total.n : 0,
    full_phone: full,
    data: (result.results || []).map(function (row) {
      return {
        id: row.id,
        nickname: row.nickname || "（還沒填資料）",
        line_name: row.line_name,
        avatar_url: row.avatar_url,
        phone: full ? row.phone : maskPhone(row.phone),
        status: row.status,
        joined_at: row.joined_at,
        team_name: row.team_name,
        games: row.games
      };
    })
  });
}


async function memberDetail(env, staff, id) {

  var full = MANAGER_ROLES.indexOf(staff.role) !== -1;

  var user = await env.DB.prepare(
    "SELECT u.*, t.team_name FROM users u LEFT JOIN teams t ON t.id = u.primary_team_id WHERE u.id = ?"
  )
  .bind(id)
  .first();

  if (!user) {
    return errorResponse("NOT_FOUND", 404);
  }

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT t.id, t.team_name, mt.status, mt.nickname, CASE WHEN t.captain_user_id = ? THEN 1 ELSE 0 END AS is_captain " +
      "FROM member_teams mt INNER JOIN teams t ON t.id = mt.team_id WHERE mt.user_id = ? ORDER BY mt.id"
    ).bind(id, id),
    env.DB.prepare(
      "SELECT p.id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, p.team_id, t.team_name, " +
      "(SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count " +
      "FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.user_id = ? ORDER BY t.team_name"
    ).bind(id),
    env.DB.prepare(
      "SELECT " +
      "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
      " WHERE (c.user_id = ? OR c.player_id IN (SELECT id FROM players WHERE user_id = ?)) " +
      " AND c.checked_in = 1 AND e.archived_at IS NOT NULL) + " +
      "(SELECT COUNT(*) FROM manual_games g WHERE g.user_id = ?) AS games, " +
      "(SELECT COUNT(*) FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id WHERE p.user_id = ?) AS wins, " +
      "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
      " WHERE c.user_id = ? AND e.archived_at IS NULL AND c.checked_in = 0) AS pending"
    ).bind(id, id, id, id, id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM player_claims WHERE user_id = ? AND status = 'pending'").bind(id)
  ]);

  var counts = (results[2].results || [])[0] || {};

  return jsonResponse({
    success: true,
    full_phone: full,
    can_link: staff.role === "sysadmin",
    data: {
      id: user.id,
      nickname: user.nickname,
      line_name: user.line_name || user.display_name,
      avatar_url: user.avatar_url,
      phone: full ? user.phone : maskPhone(user.phone),
      status: user.status,
      joined_at: user.joined_at,
      last_login_at: user.last_login_at,
      primary_team: user.team_name,
      teams: results[0].results || [],
      players: results[1].results || [],
      pending_claims: ((results[3].results || [])[0] || {}).n || 0,
      games: counts.games || 0,
      wins: counts.wins || 0,
      pending: counts.pending || 0,
      erp_member_id: "W" + user.id
    }
  });
}


async function setStatus(request, env, staff, id) {

  var body = (await parseJsonBody(request)) || {};
  var status = body.status === "disabled" ? "disabled" : "active";

  var statements = [
    env.DB.prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id)
  ];

  if (status === "disabled") {
    statements.push(env.DB.prepare("DELETE FROM member_sessions WHERE user_id = ?").bind(id));
  }

  await env.DB.batch(statements);
  await syncMemberToErp(env, id);
  await writeAuditLog(env, staff, status === "disabled" ? "disable" : "enable", "users", id, null);

  return jsonResponse({ success: true });
}


async function setCaptain(request, env, staff, id) {

  var body = (await parseJsonBody(request)) || {};

  if (!isPositiveInteger(body.team_id)) {
    return errorResponse("REQUIRED", 400, { field: "team_id" });
  }

  var teamId = Number(body.team_id);
  var unset = body.unset === true;

  await env.DB.batch(unset
    ? [env.DB.prepare("UPDATE teams SET captain_user_id = NULL WHERE id = ? AND captain_user_id = ?").bind(teamId, id)]
    : [
        env.DB.prepare("UPDATE teams SET captain_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id, teamId),
        env.DB.prepare(
          "INSERT INTO member_teams (user_id, team_id, status, approved_at) VALUES (?, ?, 'active', ?) " +
          "ON CONFLICT(user_id, team_id) DO UPDATE SET status = 'active', approved_at = excluded.approved_at"
        ).bind(id, teamId, taiwanNow()),
        env.DB.prepare("UPDATE users SET primary_team_id = ? WHERE id = ? AND primary_team_id IS NULL").bind(teamId, id)
      ]);

  if (!unset) {
    await ensurePlayer(env, id, teamId);
  }

  await syncMemberToErp(env, id);

  await writeAuditLog(env, staff, unset ? "unset_captain" : "set_captain", "teams", teamId, { user_id: id });

  return jsonResponse({ success: true });
}



/* =========================================================
   會員的戰隊暱稱、選手資料整合（只有系統管理員）
========================================================= */

async function linkPlayer(request, env, staff, userId, link) {

  var body = (await parseJsonBody(request)) || {};

  if (!isPositiveInteger(body.player_id)) {
    return errorResponse("REQUIRED", 400, { field: "player_id" });
  }

  var playerId = Number(body.player_id);

  if (link) {

    var user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();

    if (!user) {
      return errorResponse("NOT_FOUND", 404);
    }

    await env.DB.batch([
      env.DB.prepare("UPDATE players SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId, playerId),
      env.DB.prepare(
        "UPDATE player_claims SET status = 'approved', note = '由店家認領', reviewed_by = ?, reviewed_at = ? " +
        "WHERE player_id = ? AND user_id = ? AND status = 'pending'"
      ).bind(staff.display_name || String(staff.id), taiwanNow(), playerId, userId),
      env.DB.prepare(
        "UPDATE player_claims SET status = 'rejected', note = '已由其他會員認領', reviewed_by = ?, reviewed_at = ? " +
        "WHERE player_id = ? AND user_id != ? AND status = 'pending'"
      ).bind(staff.display_name || String(staff.id), taiwanNow(), playerId, userId),
      /* 選手資料所屬的戰隊，會員也一起成為隊員 */
      env.DB.prepare(
        "INSERT INTO member_teams (user_id, team_id, status, approved_at) " +
        "SELECT ?, team_id, 'active', ? FROM players WHERE id = ? AND team_id IS NOT NULL " +
        "ON CONFLICT(user_id, team_id) DO UPDATE SET status = 'active', approved_at = excluded.approved_at"
      ).bind(userId, taiwanNow(), playerId),
      env.DB.prepare(
        "UPDATE users SET primary_team_id = (SELECT team_id FROM players WHERE id = ?) " +
        "WHERE id = ? AND primary_team_id IS NULL"
      ).bind(playerId, userId)
    ]);

    /* 搬進會員：同戰隊已經有暱稱的，紀錄合併過去、刪掉這筆選手資料 */
    await attachPlayer(env, userId, playerId);
    await syncMemberToErp(env, userId);

  } else {

    await env.DB.prepare("UPDATE players SET user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
      .bind(playerId, userId)
      .run();
  }

  await markRankingDirty(env);
  await writeAuditLog(env, staff, link ? "link_player" : "unlink_player", "players", playerId, { user_id: userId });

  return jsonResponse({ success: true });
}


async function addIdentity(request, env, staff, userId) {

  var body = (await parseJsonBody(request)) || {};
  var nickname = cleanText(body.nickname);

  if (!isPositiveInteger(body.team_id)) {
    return errorResponse("REQUIRED", 400, { field: "team_id" });
  }

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  var teamId = Number(body.team_id);

  var exists = await env.DB.prepare("SELECT id FROM players WHERE user_id = ? AND team_id = ?")
    .bind(userId, teamId)
    .first();

  /* 一個戰隊只對應一個暱稱：已經有就改名 */
  if (exists) {
    await env.DB.prepare("UPDATE players SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(nickname, exists.id)
      .run();
  } else {
    await env.DB.prepare("INSERT INTO players (user_id, player_name, nickname, team_id) VALUES (?, ?, ?, ?)")
      .bind(userId, nickname, nickname, teamId)
      .run();
  }

  await env.DB.prepare(
    "INSERT INTO member_teams (user_id, team_id, status, approved_at) VALUES (?, ?, 'active', ?) " +
    "ON CONFLICT(user_id, team_id) DO UPDATE SET status = 'active'"
  )
  .bind(userId, teamId, taiwanNow())
  .run();

  await env.DB.prepare("UPDATE users SET primary_team_id = ? WHERE id = ? AND primary_team_id IS NULL")
    .bind(teamId, userId)
    .run();

  await markRankingDirty(env);
  await syncMemberToErp(env, userId);
  await writeAuditLog(env, staff, "add_identity", "users", userId, { team_id: teamId, nickname: nickname });

  return jsonResponse({ success: true });
}


async function renameIdentity(request, env, staff, userId, playerId) {

  var body = (await parseJsonBody(request)) || {};
  var nickname = cleanText(body.nickname);

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  await env.DB.batch([
    /* 改名前先把舊名字記在上位紀錄的參賽名稱 */
    env.DB.prepare(
      "UPDATE player_placements SET entry_name = COALESCE(entry_name, " +
      "(SELECT COALESCE(NULLIF(nickname, ''), player_name) FROM players WHERE id = ?)) WHERE player_id = ?"
    ).bind(playerId, playerId),
    env.DB.prepare("UPDATE players SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
      .bind(nickname, playerId, userId)
  ]);

  await markRankingDirty(env);
  await writeAuditLog(env, staff, "rename_identity", "players", playerId, { nickname: nickname });

  return jsonResponse({ success: true });
}


/* 還沒連到會員的選手資料，上位次數多的先處理；附上暱稱相同或相近的會員當建議 */
async function integration(url, env) {

  var keyword = cleanText(url.searchParams.get("q")).slice(0, 30);
  var like = "%" + keyword.replace(/[\\%_]/g, "\\$&") + "%";


  var listStatement = env.DB.prepare(
    "SELECT p.id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, p.player_name AS real_name, " +
    "t.team_name, (SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count, " +
    "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    " WHERE c.player_id = p.id AND c.checked_in = 1 AND e.archived_at IS NOT NULL) AS games " +
    "FROM players p LEFT JOIN teams t ON t.id = p.team_id " +
    "WHERE p.status = 'active' AND p.user_id IS NULL " +
    (keyword ? "AND (p.nickname LIKE ? ESCAPE '\\' OR p.player_name LIKE ? ESCAPE '\\' OR t.team_name LIKE ? ESCAPE '\\') " : "") +
    "ORDER BY upper_count DESC, games DESC, player_name ASC LIMIT 40"
  );

  var batch = await env.DB.batch([
    env.DB.prepare(
      "SELECT " +
      "(SELECT COUNT(*) FROM players WHERE status = 'active') AS total, " +
      "(SELECT COUNT(*) FROM players WHERE status = 'active' AND user_id IS NOT NULL) AS linked"
    ),
    keyword ? listStatement.bind(like, like, like) : listStatement,
    env.DB.prepare(
      "SELECT u.id, u.nickname, u.line_name, t.team_name FROM users u " +
      "LEFT JOIN teams t ON t.id = u.primary_team_id WHERE u.status = 'active' AND u.nickname IS NOT NULL"
    )
  ]);

  var counts = (batch[0].results || [])[0] || {};
  var members = batch[2].results || [];

  function norm(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
  }

  var players = (batch[1].results || []).map(function (p) {

    var name = norm(p.player_name);
    var real = norm(p.real_name);

    /* 建議：暱稱一樣 > 互相包含（例如「黑鳳凰小明」和「小明」） */
    var suggestions = members.map(function (m) {

      var nick = norm(m.nickname);
      var score = 0;

      if (nick && (nick === name || nick === real)) {
        score = 3;
      } else if (nick.length >= 2 && (name.indexOf(nick) !== -1 || nick.indexOf(name) !== -1)) {
        score = 2;
      } else if (m.team_name && p.team_name && m.team_name === p.team_name && nick.length >= 1 && name.indexOf(nick.slice(-1)) !== -1) {
        score = 1;
      }

      return { id: m.id, nickname: m.nickname, team_name: m.team_name, score: score };
    }).filter(function (m) {
      return m.score >= 2;
    }).sort(function (a, b) {
      return b.score - a.score;
    }).slice(0, 3);

    p.suggestions = suggestions;
    delete p.real_name;
    return p;
  });

  return jsonResponse({
    success: true,
    total: counts.total || 0,
    linked: counts.linked || 0,
    data: players
  });
}



/* =========================================================
   選手資料搬進會員（只有系統管理員）

   規則（每位會員只保留一筆主要的選手資料）：
   - 會員已經有選手資料 → 紀錄合併到他主要的那筆，刪掉這筆
   - 會員還沒有 → 這筆直接成為他主要的選手資料
   合併時，上位紀錄會先記下原本的名稱（參賽名稱），名字才不會不見。
========================================================= */

async function attachPlayer(env, userId, playerId) {

  var source = await env.DB.prepare("SELECT id, team_id FROM players WHERE id = ?").bind(playerId).first();

  if (!source) {
    return null;
  }

  var target = await mainPlayer(env, userId, source.id);

  if (!target) {
    await env.DB.prepare("UPDATE players SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(userId, source.id)
      .run();
    return source.id;
  }

  await mergePlayers(env, source.id, target.id, userId);

  return target.id;
}


/* 會員主要的選手資料：主要戰隊那筆優先，其次最早的一筆 */
async function mainPlayer(env, userId, excludeId) {

  var user = await env.DB.prepare("SELECT primary_team_id FROM users WHERE id = ?").bind(userId).first();

  return env.DB.prepare(
    "SELECT id FROM players WHERE user_id = ? AND id != ? " +
    "ORDER BY CASE WHEN team_id = ? THEN 0 ELSE 1 END, id LIMIT 1"
  ).bind(userId, excludeId || 0, (user && user.primary_team_id) || 0).first();
}


/* 系統管理員設定會員的主要暱稱和戰隊（排行榜會跟著顯示這個） */
async function setMain(request, env, staff, userId) {

  var body = (await parseJsonBody(request)) || {};
  var nickname = cleanText(body.nickname);
  var teamId = isPositiveInteger(body.team_id) ? Number(body.team_id) : null;

  if (!validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  var user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();

  if (!user) {
    return errorResponse("NOT_FOUND", 404);
  }

  var main = await mainPlayer(env, userId, 0);
  var statements = [
    env.DB.prepare(
      "UPDATE users SET nickname = ?, display_name = ?, primary_team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(nickname, nickname, teamId, userId)
  ];

  if (main) {
    /* 改名前先把舊名字記在上位紀錄的參賽名稱 */
    statements.push(env.DB.prepare(
      "UPDATE player_placements SET entry_name = COALESCE(entry_name, " +
      "(SELECT COALESCE(NULLIF(nickname, ''), player_name) FROM players WHERE id = ?)) WHERE player_id = ?"
    ).bind(main.id, main.id));
    statements.push(env.DB.prepare(
      "UPDATE players SET nickname = ?, team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(nickname, teamId, main.id));
  } else {
    statements.push(env.DB.prepare(
      "INSERT INTO players (user_id, player_name, nickname, team_id) VALUES (?, ?, ?, ?)"
    ).bind(userId, nickname, nickname, teamId));
  }

  if (teamId) {
    statements.push(env.DB.prepare(
      "INSERT INTO member_teams (user_id, team_id, status, approved_at) VALUES (?, ?, 'active', ?) " +
      "ON CONFLICT(user_id, team_id) DO UPDATE SET status = 'active'"
    ).bind(userId, teamId, taiwanNow()));
  }

  await env.DB.batch(statements);
  await markRankingDirty(env);
  await syncMemberToErp(env, userId);
  await writeAuditLog(env, staff, "set_main", "users", userId, { nickname: nickname, team_id: teamId });

  return jsonResponse({ success: true });
}


export async function mergePlayers(env, fromId, intoId, userId) {

  await env.DB.batch([
    /* 先記下這筆原本的名稱，當作那幾場的參賽名稱 */
    env.DB.prepare(
      "UPDATE player_placements SET entry_name = COALESCE(entry_name, " +
      "(SELECT COALESCE(NULLIF(nickname, ''), player_name) FROM players WHERE id = ?)) WHERE player_id = ?"
    ).bind(fromId, fromId),
    env.DB.prepare(
      "UPDATE player_placements SET entry_name = COALESCE(entry_name, " +
      "(SELECT COALESCE(NULLIF(nickname, ''), player_name) FROM players WHERE id = ?)) WHERE player_id = ?"
    ).bind(intoId, intoId),
    env.DB.prepare("UPDATE player_placements SET player_id = ? WHERE player_id = ?").bind(intoId, fromId),
    env.DB.prepare(
      "UPDATE checkin_entries SET player_id = ?, user_id = COALESCE(user_id, ?) WHERE player_id = ?"
    ).bind(intoId, userId || null, fromId),
    env.DB.prepare("UPDATE league_matches SET player_a_id = ? WHERE player_a_id = ?").bind(intoId, fromId),
    env.DB.prepare("UPDATE league_matches SET player_b_id = ? WHERE player_b_id = ?").bind(intoId, fromId),
    env.DB.prepare("UPDATE tournament_results SET player_id = ? WHERE player_id = ?").bind(intoId, fromId),
    env.DB.prepare("DELETE FROM player_ranking WHERE player_id = ?").bind(fromId),
    env.DB.prepare("DELETE FROM player_claims WHERE player_id = ?").bind(fromId),
    env.DB.prepare("DELETE FROM players WHERE id = ?").bind(fromId)
  ]);

  await markRankingDirty(env);
}


/* 手動合併：把會員的某一筆選手資料合併到另一筆（例如同一個人的兩個舊名字） */
async function mergeRequest(request, env, staff, userId) {

  var body = (await parseJsonBody(request)) || {};

  if (!isPositiveInteger(body.from_player_id) || !isPositiveInteger(body.into_player_id) ||
      Number(body.from_player_id) === Number(body.into_player_id)) {
    return errorResponse("REQUIRED", 400);
  }

  var rows = await env.DB.prepare(
    "SELECT id, user_id FROM players WHERE id IN (?, ?)"
  ).bind(Number(body.from_player_id), Number(body.into_player_id)).all();

  var list = rows.results || [];

  /* 要合併的兩筆都必須是這位會員的（或來源還沒連到任何會員） */
  var into = list.filter(function (p) { return p.id === Number(body.into_player_id); })[0];
  var from = list.filter(function (p) { return p.id === Number(body.from_player_id); })[0];

  if (!into || !from || into.user_id !== userId || (from.user_id && from.user_id !== userId)) {
    return errorResponse("FORBIDDEN", 403);
  }

  await mergePlayers(env, from.id, into.id, userId);
  await writeAuditLog(env, staff, "merge_player", "players", into.id, { from: from.id, user_id: userId });

  return jsonResponse({ success: true });
}


/* 有一筆以上選手資料的會員 */
async function multiPlayers(env) {

  var rows = await env.DB.prepare(
    "SELECT u.id AS user_id, u.nickname AS member, p.id AS player_id, " +
    "COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, t.team_name, " +
    "(SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = p.id) AS upper_count, " +
    "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    " WHERE c.player_id = p.id AND c.checked_in = 1 AND e.archived_at IS NOT NULL) AS games " +
    "FROM users u INNER JOIN players p ON p.user_id = u.id LEFT JOIN teams t ON t.id = p.team_id " +
    "WHERE u.id IN (SELECT user_id FROM players WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1) " +
    "ORDER BY u.nickname, t.team_name"
  ).all();

  var members = [];
  var map = {};

  (rows.results || []).forEach(function (row) {

    if (!map[row.user_id]) {
      map[row.user_id] = { user_id: row.user_id, member: row.member, players: [] };
      members.push(map[row.user_id]);
    }

    map[row.user_id].players.push({
      id: row.player_id,
      player_name: row.player_name,
      team_name: row.team_name,
      upper_count: row.upper_count,
      games: row.games
    });
  });

  return jsonResponse({ success: true, data: members });
}



/* =========================================================
   系統管理員：手動補登會員的參賽紀錄、上位紀錄
========================================================= */

function cleanDate(value) {
  var text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}


function cleanCount(value, min) {
  var number = Number(value);
  return Number.isInteger(number) && number >= min && number <= 9999 ? number : null;
}


async function memberRecords(env, userId) {

  var results = await env.DB.batch([
    env.DB.prepare(
      "SELECT 'checkin' AS source, NULL AS id, e.event_date, e.title AS event_name, " +
      "(SELECT COUNT(*) FROM checkin_entries x WHERE x.event_id = e.id AND x.checked_in = 1) AS participant_count, c.nickname AS entry_name " +
      "FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
      "WHERE (c.user_id = ? OR c.player_id IN (SELECT id FROM players WHERE user_id = ?)) " +
      "AND c.checked_in = 1 AND e.archived_at IS NOT NULL " +
      "UNION ALL " +
      "SELECT 'manual' AS source, g.id, g.event_date, g.event_name, g.participant_count, g.entry_name " +
      "FROM manual_games g WHERE g.user_id = ? " +
      "ORDER BY event_date DESC LIMIT 200"
    ).bind(userId, userId, userId),
    env.DB.prepare(
      "SELECT pp.id, pp.event_date, pp.event_name, pp.participant_count, pp.placement, pp.entry_name, pp.configs, " +
      "CASE WHEN EXISTS (SELECT 1 FROM checkin_results r WHERE r.placement_id = pp.id) THEN 'checkin' ELSE 'manual' END AS source " +
      "FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id " +
      "WHERE p.user_id = ? ORDER BY pp.event_date DESC, pp.id DESC LIMIT 200"
    ).bind(userId)
  ]);

  return jsonResponse({ success: true, games: results[0].results || [], placements: results[1].results || [] });
}


async function addManualGame(request, env, staff, userId) {

  var body = (await parseJsonBody(request)) || {};
  var date = cleanDate(body.event_date);
  var name = cleanText(body.event_name).slice(0, 100);

  if (!date) {
    return errorResponse("INVALID_DATE", 400, { field: "event_date" });
  }

  if (!name) {
    return errorResponse("REQUIRED", 400, { field: "event_name" });
  }

  await env.DB.prepare(
    "INSERT INTO manual_games (user_id, event_date, event_name, participant_count, entry_name, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  )
  .bind(userId, date, name, cleanCount(body.participant_count, 1), cleanText(body.entry_name).slice(0, 50) || null,
    staff.display_name || String(staff.id))
  .run();

  await writeAuditLog(env, staff, "add_manual_game", "users", userId, { date: date, name: name });

  return memberRecords(env, userId);
}


async function deleteManualGame(env, staff, userId, gameId) {

  await env.DB.prepare("DELETE FROM manual_games WHERE id = ? AND user_id = ?").bind(gameId, userId).run();
  await writeAuditLog(env, staff, "delete_manual_game", "users", userId, { id: gameId });

  return memberRecords(env, userId);
}


async function addManualPlacement(request, env, staff, userId) {

  var body = (await parseJsonBody(request)) || {};
  var date = cleanDate(body.event_date);
  var name = cleanText(body.event_name).slice(0, 100);
  var total = cleanCount(body.participant_count, 1);
  var placement = cleanCount(body.placement, 1);

  if (!date) {
    return errorResponse("INVALID_DATE", 400, { field: "event_date" });
  }

  if (!name) {
    return errorResponse("REQUIRED", 400, { field: "event_name" });
  }

  if (!total || !placement || placement > total) {
    return errorResponse("INVALID_NUMBER", 400, { field: "placement" });
  }

  var user = await env.DB.prepare("SELECT id, nickname, primary_team_id FROM users WHERE id = ?").bind(userId).first();

  if (!user) {
    return errorResponse("NOT_FOUND", 404);
  }

  /* 上位紀錄掛在會員主要的那筆選手資料 */
  var main = await mainPlayer(env, userId, 0);
  var playerId = main ? main.id : null;

  if (!playerId) {
    var created = await env.DB.prepare(
      "INSERT INTO players (user_id, player_name, nickname, team_id) VALUES (?, ?, ?, ?)"
    ).bind(userId, user.nickname || "會員", user.nickname || "會員", user.primary_team_id || null).run();
    playerId = created.meta.last_row_id;
  }

  var configs = (Array.isArray(body.configs) ? body.configs : []).map(function (text) {
    return cleanText(text).slice(0, 100);
  }).filter(Boolean).slice(0, 10);

  var entryName = cleanText(body.entry_name).slice(0, 50) || user.nickname || null;

  var statements = [
    env.DB.prepare(
      "INSERT INTO player_placements (player_id, event_date, event_name, participant_count, placement, entry_name, configs) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(playerId, date, name, total, placement, entryName, configs.length ? JSON.stringify(configs) : null)
  ];

  /* 同一場順便補一筆參賽紀錄（有上位當然有參賽） */
  if (body.also_game !== false) {
    statements.push(env.DB.prepare(
      "INSERT INTO manual_games (user_id, event_date, event_name, participant_count, entry_name, created_by) " +
      "SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS " +
      "(SELECT 1 FROM manual_games WHERE user_id = ? AND event_date = ? AND event_name = ?)"
    ).bind(userId, date, name, total, entryName, staff.display_name || String(staff.id), userId, date, name));
  }

  await env.DB.batch(statements);
  await markRankingDirty(env);
  await writeAuditLog(env, staff, "add_manual_placement", "users", userId, { date: date, name: name, placement: placement });

  return memberRecords(env, userId);
}


async function deleteMemberPlacement(env, staff, userId, placementId) {

  /* 報到系統封存寫入的，請用「解除封存」撤回，這裡只刪手動補登的 */
  var row = await env.DB.prepare(
    "SELECT pp.id FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id " +
    "WHERE pp.id = ? AND p.user_id = ? AND NOT EXISTS (SELECT 1 FROM checkin_results r WHERE r.placement_id = pp.id)"
  ).bind(placementId, userId).first();

  if (!row) {
    return errorResponse("FORBIDDEN", 403);
  }

  await env.DB.prepare("DELETE FROM player_placements WHERE id = ?").bind(placementId).run();
  await markRankingDirty(env);
  await writeAuditLog(env, staff, "delete_manual_placement", "users", userId, { id: placementId });

  return memberRecords(env, userId);
}


async function setMemberTeamNickname(request, env, staff, userId, teamId) {

  var body = (await parseJsonBody(request)) || {};
  var nickname = cleanText(body.nickname).slice(0, 50);

  if (nickname && !validName(nickname)) {
    return errorResponse("INVALID_NAME", 400, { field: "nickname" });
  }

  await env.DB.prepare("UPDATE member_teams SET nickname = ? WHERE user_id = ? AND team_id = ?")
    .bind(nickname || null, userId, teamId)
    .run();

  await writeAuditLog(env, staff, "set_team_nickname", "users", userId, { team_id: teamId, nickname: nickname });

  return jsonResponse({ success: true });
}
