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
import { syncMemberToErp } from "./member-api.js";


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

      /* 這位會員以前的報名，名字相同、還沒綁選手的，一起補上 */
      statements.push(
        env.DB.prepare(
          "UPDATE checkin_entries SET player_id = ? WHERE user_id = ? AND player_id IS NULL"
        ).bind(claim.player_id, claim.user_id)
      );
    }

    await env.DB.batch(statements);
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

    where.push(
      "(u.nickname LIKE ? ESCAPE '\\' OR u.line_name LIKE ? ESCAPE '\\' OR t.team_name LIKE ? ESCAPE '\\'" +
      (digits.length >= 3 ? " OR replace(replace(u.phone, '-', ''), ' ', '') LIKE ?" : "") + ")"
    );

    binds.push(like, like, like);

    if (digits.length >= 3) {
      binds.push("%" + digits + "%");
    }
  }

  var statement = env.DB.prepare(
    "SELECT u.id, u.nickname, u.line_name, u.avatar_url, u.phone, u.status, u.joined_at, t.team_name, " +
    "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
    " WHERE c.user_id = u.id AND c.checked_in = 1 AND e.archived_at IS NOT NULL) AS games " +
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
      "SELECT t.id, t.team_name, mt.status, CASE WHEN t.captain_user_id = ? THEN 1 ELSE 0 END AS is_captain " +
      "FROM member_teams mt INNER JOIN teams t ON t.id = mt.team_id WHERE mt.user_id = ? ORDER BY mt.id"
    ).bind(id, id),
    env.DB.prepare(
      "SELECT p.id, COALESCE(NULLIF(p.nickname, ''), p.player_name) AS player_name, t.team_name " +
      "FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.user_id = ?"
    ).bind(id),
    env.DB.prepare(
      "SELECT " +
      "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
      " WHERE c.user_id = ? AND c.checked_in = 1 AND e.archived_at IS NOT NULL) AS games, " +
      "(SELECT COUNT(*) FROM player_placements pp INNER JOIN players p ON p.id = pp.player_id WHERE p.user_id = ?) AS wins, " +
      "(SELECT COUNT(*) FROM checkin_entries c INNER JOIN checkin_events e ON e.id = c.event_id " +
      " WHERE c.user_id = ? AND e.archived_at IS NULL AND c.checked_in = 0) AS pending"
    ).bind(id, id, id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM player_claims WHERE user_id = ? AND status = 'pending'").bind(id)
  ]);

  var counts = (results[2].results || [])[0] || {};

  return jsonResponse({
    success: true,
    full_phone: full,
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

  await syncMemberToErp(env, id);

  await writeAuditLog(env, staff, unset ? "unset_captain" : "set_captain", "teams", teamId, { user_id: id });

  return jsonResponse({ success: true });
}
