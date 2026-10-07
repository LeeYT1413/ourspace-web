/* =========================================================
   OURSPACE
   管理員 API（只有 admin 角色可用）
========================================================= */

import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  cleanText,
  isPositiveInteger,
  taiwanNow,
  MAX_TOTAL_SCORE,
  MATCH_FORMATS
} from "./util.js";

import {
  requireStaff,
  writeAuditLog,
  createPasswordRecord,
  validateUsername,
  validatePassword,
  deleteStaffSessions,
  STAFF_ROLES
} from "./auth.js";


/* =========================================================
   資料表設定
   只有列在 columns 裡的欄位可以被寫入
========================================================= */

var ACTIVE_STATUS = ["active", "inactive"];

var RESOURCES = {

  news: {
    table: "news",
    order: "published_at DESC, id DESC",
    hasUpdatedAt: true,
    columns: {
      title: { type: "text", required: true, max: 200 },
      summary: { type: "text", max: 500 },
      content: { type: "text", max: 20000 },
      cover_image_url: { type: "url" },
      category: { type: "enum", values: ["news", "event", "battle", "store"], default: "news" },
      status: { type: "enum", values: ["published", "draft"], default: "draft" },
      sort_order: { type: "int", default: 0 },
      published_at: { type: "datetime" }
    },
    prepare: function (values) {
      /* 發布時沒填時間，就用現在的台灣時間（新增或草稿改發布都適用） */
      if (values.status === "published" && !values.published_at) {
        values.published_at = taiwanNow();
      }
      return null;
    }
  },

  news_images: {
    table: "news_images",
    order: "sort_order ASC, id ASC",
    hasUpdatedAt: false,
    columns: {
      image_url: { type: "url", required: true },
      title: { type: "text", max: 100 },
      subtitle: { type: "text", max: 200 },
      link_url: { type: "url" },
      sort_order: { type: "int", default: 0 },
      status: { type: "enum", values: ACTIVE_STATUS, default: "active" }
    }
  },

  tournaments: {
    table: "tournaments",
    order: "start_at DESC, id DESC",
    hasUpdatedAt: true,
    columns: {
      tournament_code: { type: "text", max: 50 },
      title: { type: "text", required: true, max: 200 },
      tournament_type: { type: "enum", values: ["team", "solo"], required: true },
      description: { type: "text", max: 10000 },
      cover_image_url: { type: "url" },
      location: { type: "text", max: 200 },
      start_at: { type: "datetime" },
      end_at: { type: "datetime" },
      registration_start_at: { type: "datetime" },
      registration_end_at: { type: "datetime" },
      max_players: { type: "int", min: 1 },
      max_teams: { type: "int", min: 1 },
      entry_fee: { type: "int", min: 0, default: 0 },
      status: {
        type: "enum",
        values: ["draft", "coming", "open", "closed", "ongoing", "finished"],
        default: "draft"
      }
    }
  },

  teams: {
    table: "teams",
    order: "team_name ASC",
    hasUpdatedAt: true,
    columns: {
      team_code: { type: "text", max: 50 },
      team_name: { type: "text", required: true, max: 100 },
      team_logo_url: { type: "url" },
      description: { type: "text", max: 2000 },
      status: { type: "enum", values: ACTIVE_STATUS, default: "active" }
    }
  },

  players: {
    table: "players",
    order: "player_name ASC",
    hasUpdatedAt: true,
    /* 列表多帶「上位次數」 */
    listSelect:
      "SELECT players.*, " +
      "(SELECT COUNT(*) FROM player_placements pp WHERE pp.player_id = players.id) AS upper_count " +
      "FROM players",
    columns: {
      player_name: { type: "text", required: true, max: 100 },
      nickname: { type: "text", max: 100 },
      avatar_url: { type: "url" },
      team_id: { type: "ref" },
      status: { type: "enum", values: ACTIVE_STATUS, default: "active" }
    }
  },

  league_matches: {
    table: "league_matches",
    order: "scheduled_at DESC, id DESC",
    hasUpdatedAt: true,
    columns: {
      tournament_id: { type: "ref", required: true },
      match_format: { type: "enum", values: MATCH_FORMATS, default: "solo" },
      round_number: { type: "int", min: 0 },
      match_number: { type: "int", min: 0 },
      scheduled_at: { type: "datetime", required: true },
      player_a_id: { type: "ref" },
      player_b_id: { type: "ref" },
      team_a_id: { type: "ref" },
      team_b_id: { type: "ref" },
      score_a: { type: "int", min: 0 },
      score_b: { type: "int", min: 0 },
      status: {
        type: "enum",
        values: ["scheduled", "live", "paused", "finished", "cancelled"],
        default: "scheduled"
      },
      field_name: { type: "text", max: 50 },
      note: { type: "text", max: 500 }
    },
    prepare: async function (values, isCreate, env, existing) {

      /* 有送來的值優先，沒送的用資料庫原本的值 */
      function pick(name) {
        if (values[name] !== undefined) {
          return values[name];
        }
        return existing ? existing[name] : null;
      }

      if (pick("match_format") === "solo") {

        /* 個人賽：選選手，戰隊自動帶入選手目前所屬的戰隊 */
        if (values.player_a_id && values.player_a_id === values.player_b_id) {
          return "SAME_PLAYER";
        }

        var teamsByPlayer = await loadPlayerTeams(env, [values.player_a_id, values.player_b_id]);
        var sides = ["a", "b"];

        for (var i = 0; i < sides.length; i++) {

          var playerId = values["player_" + sides[i] + "_id"];

          if (!playerId) {
            continue;
          }

          if (!Object.prototype.hasOwnProperty.call(teamsByPlayer, playerId)) {
            return "INVALID_REFERENCE";
          }

          if (!teamsByPlayer[playerId]) {
            return "PLAYER_NO_TEAM";
          }

          values["team_" + sides[i] + "_id"] = teamsByPlayer[playerId];
        }

        if (pick("team_a_id") && pick("team_a_id") === pick("team_b_id")) {
          return "SAME_TEAM_PLAYERS";
        }

      } else {

        /* 雙人 / 三人 / 戰隊賽：選戰隊，清掉選手 */
        if (values.match_format !== undefined) {
          values.player_a_id = null;
          values.player_b_id = null;
        }

        if (pick("team_a_id") && pick("team_a_id") === pick("team_b_id")) {
          return "SAME_TEAM";
        }
      }

      var a = pick("score_a") || 0;
      var b = pick("score_b") || 0;

      if (a + b > MAX_TOTAL_SCORE) {
        return "SCORE_OVER_LIMIT";
      }

      if (values.status !== undefined) {

        /* 比賽結束：兩隊加總必須剛好 9 分（不會平手） */
        if (values.status === "finished" && a + b !== MAX_TOTAL_SCORE) {
          return "SCORE_NOT_COMPLETE";
        }

        /* 勝方一律依比分自動判定，避免和積分對不上 */
        values.winner_team_id =
          values.status === "finished" && a !== b
            ? (a > b ? pick("team_a_id") : pick("team_b_id")) || null
            : null;
      }

      return null;
    }
  },

  /* 選手上位紀錄：一筆 = 一次上位 */
  player_placements: {
    table: "player_placements",
    order: "event_date DESC, id DESC",
    hasUpdatedAt: false,
    filters: ["player_id"],
    columns: {
      player_id: { type: "ref", required: true },
      event_date: { type: "date", required: true },
      event_name: { type: "text", required: true, max: 100 },
      participant_count: { type: "int", required: true, min: 1 },
      placement: { type: "int", required: true, min: 1 }
    },
    prepare: function (values) {
      if (
        values.placement !== undefined &&
        values.participant_count !== undefined &&
        values.placement > values.participant_count
      ) {
        return "PLACEMENT_OVER_COUNT";
      }
      return null;
    }
  },

  player_ranking: {
    table: "player_ranking",
    order: "season_name DESC, rank_number ASC",
    hasUpdatedAt: true,
    columns: {
      player_id: { type: "ref", required: true },
      season_name: { type: "text", required: true, max: 50 },
      rank_number: { type: "int", required: true, min: 1 },
      win_count: { type: "int", min: 0, default: 0 },
      upper_count: { type: "int", min: 0, default: 0 },
      points: { type: "int", default: 0 }
    }
  },

  contact_messages: {
    table: "contact_messages",
    order: "created_at DESC, id DESC",
    hasUpdatedAt: false,
    allowCreate: false,
    columns: {
      status: { type: "enum", values: ["unread", "read", "done"], default: "unread" }
    }
  }

};


/* =========================================================
   欄位驗證
========================================================= */

function normalizeValue(def, raw) {

  var isEmpty =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");

  if (isEmpty) {

    if (def.required) {
      return { error: "REQUIRED" };
    }

    return { value: def.default !== undefined ? def.default : null };
  }

  var text = String(raw).trim();

  if (def.type === "text") {

    if (text.length > (def.max || 500)) {
      return { error: "TOO_LONG" };
    }

    return { value: text };
  }

  if (def.type === "int") {

    var number = Number(text);

    if (!Number.isInteger(number)) {
      return { error: "INVALID_NUMBER" };
    }

    if (def.min !== undefined && number < def.min) {
      return { error: "INVALID_NUMBER" };
    }

    return { value: number };
  }

  if (def.type === "ref") {

    if (!isPositiveInteger(text)) {
      return { error: "INVALID_REFERENCE" };
    }

    return { value: Number(text) };
  }

  if (def.type === "enum") {

    if (def.values.indexOf(text) === -1) {
      return { error: "INVALID_OPTION" };
    }

    return { value: text };
  }

  if (def.type === "date") {

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { error: "INVALID_DATE" };
    }

    return { value: text };
  }

  if (def.type === "datetime") {

    var datetime = text.replace("T", " ");

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(datetime)) {
      return { error: "INVALID_DATETIME" };
    }

    return { value: datetime.slice(0, 16) };
  }

  if (def.type === "url") {

    var isValid =
      /^https?:\/\/\S+$/i.test(text) ||
      /^\/[^\/\s]\S*$/.test(text);

    if (!isValid || text.length > 1000) {
      return { error: "INVALID_URL" };
    }

    return { value: text };
  }

  return { error: "UNKNOWN_FIELD" };

}


/* 回傳 { values } 或 { error, field } */
async function collectValues(config, body, isCreate, env, existing) {

  var values = {};
  var names = Object.keys(config.columns);

  for (var i = 0; i < names.length; i++) {

    var name = names[i];

    /* 修改時只處理有送來的欄位 */
    if (!isCreate && !Object.prototype.hasOwnProperty.call(body, name)) {
      continue;
    }

    var result = normalizeValue(config.columns[name], body[name]);

    if (result.error) {
      return { error: result.error, field: name };
    }

    values[name] = result.value;
  }

  if (config.prepare) {

    var prepareError = await config.prepare(values, isCreate, env, existing || null);

    if (prepareError) {
      return { error: prepareError };
    }
  }

  return { values: values };

}


/* 資料庫錯誤 → 清楚的錯誤代碼 */
function databaseErrorResponse(error) {

  var message = String((error && error.message) || error);

  if (message.indexOf("FOREIGN KEY") !== -1) {
    return errorResponse("IN_USE_OR_INVALID_REFERENCE", 409);
  }

  if (message.indexOf("UNIQUE") !== -1) {
    return errorResponse("DUPLICATE", 409);
  }

  throw error;

}


/* 查選手目前所屬的戰隊：{ 選手 id: 戰隊 id 或 null } */
async function loadPlayerTeams(env, ids) {

  var list = ids.filter(function (id) {
    return Boolean(id);
  });

  var map = {};

  if (!list.length) {
    return map;
  }

  var placeholders = list.map(function () {
    return "?";
  });

  var statement = env.DB.prepare(
    "SELECT id, team_id FROM players WHERE id IN (" + placeholders.join(", ") + ")"
  );

  var result = await statement.bind.apply(statement, list).all();

  (result.results || []).forEach(function (row) {
    map[row.id] = row.team_id;
  });

  return map;

}


/* =========================================================
   路由
========================================================= */

export async function handleAdminApi(request, url, env) {

  var auth = await requireStaff(request, env, ["admin"]);

  if (auth.response) {
    return auth.response;
  }

  var staff = auth.staff;
  var method = request.method;
  var parts = url.pathname.split("/").filter(Boolean);
  var resource = parts[2];
  var id = parts[3];

  if (parts.length > 4) {
    return null;
  }

  if (resource === "lookups" && !id && method === "GET") {
    return getLookups(env);
  }

  if (resource === "staff") {
    return handleStaff(request, env, staff, method, id);
  }

  var config = Object.prototype.hasOwnProperty.call(RESOURCES, resource)
    ? RESOURCES[resource]
    : null;

  if (!config) {
    return null;
  }

  if (!id) {

    if (method === "GET") {
      return listRecords(env, config, url);
    }

    if (method === "POST" && config.allowCreate !== false) {
      return createRecord(request, env, staff, resource, config);
    }

    return null;
  }

  if (!isPositiveInteger(id)) {
    return errorResponse("INVALID_ID", 400);
  }

  id = Number(id);

  if (method === "PUT") {
    return updateRecord(request, env, staff, resource, config, id);
  }

  if (method === "DELETE") {
    return deleteRecord(env, staff, resource, config, id);
  }

  return null;

}


/* =========================================================
   通用 CRUD
========================================================= */

async function listRecords(env, config, url) {

  var sql = config.listSelect || "SELECT * FROM " + config.table;
  var conditions = [];
  var bindings = [];

  /* 允許的篩選條件，例如 ?player_id=3 */
  (config.filters || []).forEach(function (name) {

    var value = url.searchParams.get(name);

    if (isPositiveInteger(value)) {
      conditions.push(name + " = ?");
      bindings.push(Number(value));
    }
  });

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY " + config.order + " LIMIT 1000";

  var statement = env.DB.prepare(sql);

  if (bindings.length) {
    statement = statement.bind.apply(statement, bindings);
  }

  var result = await statement.all();

  return jsonResponse({ success: true, data: result.results || [] });

}


async function getRecord(env, config, id) {

  return env.DB.prepare("SELECT * FROM " + config.table + " WHERE id = ?")
    .bind(id)
    .first();

}


async function createRecord(request, env, staff, resource, config) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var collected = await collectValues(config, body, true, env, null);

  if (collected.error) {
    return errorResponse(collected.error, 400, { field: collected.field || null });
  }

  var names = Object.keys(collected.values);

  var placeholders = names.map(function () {
    return "?";
  });

  var bindings = names.map(function (name) {
    return collected.values[name];
  });

  var result;

  try {

    var statement = env.DB.prepare(
      "INSERT INTO " + config.table +
      " (" + names.join(", ") + ") VALUES (" + placeholders.join(", ") + ")"
    );

    result = await statement.bind.apply(statement, bindings).run();

  } catch (error) {
    return databaseErrorResponse(error);
  }

  var id = result.meta.last_row_id;

  await writeAuditLog(env, staff, "create", resource, id, collected.values);

  return jsonResponse(
    { success: true, data: await getRecord(env, config, id) },
    201
  );

}


async function updateRecord(request, env, staff, resource, config, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var existing = await getRecord(env, config, id);

  if (!existing) {
    return errorResponse("NOT_FOUND", 404);
  }

  var collected = await collectValues(config, body, false, env, existing);

  if (collected.error) {
    return errorResponse(collected.error, 400, { field: collected.field || null });
  }

  var names = Object.keys(collected.values);

  if (!names.length) {
    return jsonResponse({ success: true, data: existing });
  }

  var assignments = names.map(function (name) {
    return name + " = ?";
  });

  if (config.hasUpdatedAt) {
    assignments.push("updated_at = CURRENT_TIMESTAMP");
  }

  var bindings = names.map(function (name) {
    return collected.values[name];
  });

  bindings.push(id);

  try {

    var statement = env.DB.prepare(
      "UPDATE " + config.table +
      " SET " + assignments.join(", ") + " WHERE id = ?"
    );

    await statement.bind.apply(statement, bindings).run();

  } catch (error) {
    return databaseErrorResponse(error);
  }

  await writeAuditLog(env, staff, "update", resource, id, collected.values);

  return jsonResponse({ success: true, data: await getRecord(env, config, id) });

}


async function deleteRecord(env, staff, resource, config, id) {

  var existing = await getRecord(env, config, id);

  if (!existing) {
    return errorResponse("NOT_FOUND", 404);
  }

  try {

    await env.DB.prepare("DELETE FROM " + config.table + " WHERE id = ?")
      .bind(id)
      .run();

  } catch (error) {
    return databaseErrorResponse(error);
  }

  await writeAuditLog(env, staff, "delete", resource, id, existing);

  return jsonResponse({ success: true });

}


/* =========================================================
   下拉選單資料
========================================================= */

async function getLookups(env) {

  var results = await env.DB.batch([
    env.DB.prepare("SELECT id, team_name FROM teams ORDER BY team_name ASC"),
    env.DB.prepare("SELECT id, title, tournament_type FROM tournaments ORDER BY start_at DESC, id DESC"),
    env.DB.prepare("SELECT id, player_name, nickname, team_id FROM players ORDER BY player_name ASC")
  ]);

  return jsonResponse({
    success: true,
    data: {
      teams: results[0].results || [],
      tournaments: results[1].results || [],
      players: results[2].results || []
    }
  });

}


/* =========================================================
   後台帳號管理
========================================================= */

var STAFF_COLUMNS =
  "id, username, display_name, role, status, last_login_at, created_at";


async function handleStaff(request, env, staff, method, id) {

  if (!id) {

    if (method === "GET") {

      var list =
        await env.DB.prepare(
          "SELECT " + STAFF_COLUMNS + " FROM staff_users ORDER BY role ASC, username ASC"
        )
        .all();

      return jsonResponse({ success: true, data: list.results || [] });
    }

    if (method === "POST") {
      return createStaff(request, env, staff);
    }

    return null;
  }

  if (!isPositiveInteger(id)) {
    return errorResponse("INVALID_ID", 400);
  }

  id = Number(id);

  if (method === "PUT") {
    return updateStaff(request, env, staff, id);
  }

  if (method === "DELETE") {

    if (id === staff.id) {
      return errorResponse("CANNOT_DELETE_SELF", 400);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM staff_sessions WHERE staff_id = ?").bind(id),
      env.DB.prepare("DELETE FROM staff_users WHERE id = ?").bind(id)
    ]);

    await writeAuditLog(env, staff, "delete", "staff_users", id);

    return jsonResponse({ success: true });
  }

  return null;

}


async function getStaffRecord(env, id) {

  return env.DB.prepare("SELECT " + STAFF_COLUMNS + " FROM staff_users WHERE id = ?")
    .bind(id)
    .first();

}


async function createStaff(request, env, staff) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var username = cleanText(body.username);
  var displayName = cleanText(body.display_name);
  var role = cleanText(body.role) || "referee";
  var status = cleanText(body.status) || "active";
  var password = typeof body.password === "string" ? body.password : "";

  if (!validateUsername(username)) {
    return errorResponse("INVALID_USERNAME", 400, { field: "username" });
  }

  if (!displayName || displayName.length > 50) {
    return errorResponse("INVALID_DISPLAY_NAME", 400, { field: "display_name" });
  }

  if (STAFF_ROLES.indexOf(role) === -1) {
    return errorResponse("INVALID_OPTION", 400, { field: "role" });
  }

  if (ACTIVE_STATUS.indexOf(status) === -1) {
    return errorResponse("INVALID_OPTION", 400, { field: "status" });
  }

  if (!validatePassword(password)) {
    return errorResponse("WEAK_PASSWORD", 400, { field: "password" });
  }

  var record = await createPasswordRecord(password);
  var result;

  try {

    result =
      await env.DB.prepare(
        "INSERT INTO staff_users " +
        "(username, display_name, role, status, password_hash, password_salt) " +
        "VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(username, displayName, role, status, record.hash, record.salt)
      .run();

  } catch (error) {
    return databaseErrorResponse(error);
  }

  var newId = result.meta.last_row_id;

  await writeAuditLog(env, staff, "create", "staff_users", newId, {
    username: username,
    role: role
  });

  return jsonResponse(
    { success: true, data: await getStaffRecord(env, newId) },
    201
  );

}


async function updateStaff(request, env, staff, id) {

  var body = await parseJsonBody(request);

  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  var existing = await getStaffRecord(env, id);

  if (!existing) {
    return errorResponse("NOT_FOUND", 404);
  }

  var assignments = [];
  var bindings = [];
  var logoutUser = false;

  if (body.display_name !== undefined) {

    var displayName = cleanText(body.display_name);

    if (!displayName || displayName.length > 50) {
      return errorResponse("INVALID_DISPLAY_NAME", 400, { field: "display_name" });
    }

    assignments.push("display_name = ?");
    bindings.push(displayName);
  }

  if (body.role !== undefined) {

    var role = cleanText(body.role);

    if (STAFF_ROLES.indexOf(role) === -1) {
      return errorResponse("INVALID_OPTION", 400, { field: "role" });
    }

    /* 避免把自己降級後失去管理權限 */
    if (id === staff.id && role !== "admin") {
      return errorResponse("CANNOT_DEMOTE_SELF", 400, { field: "role" });
    }

    assignments.push("role = ?");
    bindings.push(role);
  }

  if (body.status !== undefined) {

    var status = cleanText(body.status);

    if (ACTIVE_STATUS.indexOf(status) === -1) {
      return errorResponse("INVALID_OPTION", 400, { field: "status" });
    }

    if (id === staff.id && status !== "active") {
      return errorResponse("CANNOT_DISABLE_SELF", 400, { field: "status" });
    }

    if (status !== "active") {
      logoutUser = true;
    }

    assignments.push("status = ?");
    bindings.push(status);
  }

  /* 密碼留空表示不修改 */
  if (typeof body.password === "string" && body.password !== "") {

    if (!validatePassword(body.password)) {
      return errorResponse("WEAK_PASSWORD", 400, { field: "password" });
    }

    var record = await createPasswordRecord(body.password);

    assignments.push("password_hash = ?", "password_salt = ?", "failed_count = 0", "locked_until = NULL");
    bindings.push(record.hash, record.salt);

    logoutUser = true;
  }

  if (!assignments.length) {
    return jsonResponse({ success: true, data: existing });
  }

  assignments.push("updated_at = CURRENT_TIMESTAMP");
  bindings.push(id);

  var statement = env.DB.prepare(
    "UPDATE staff_users SET " + assignments.join(", ") + " WHERE id = ?"
  );

  await statement.bind.apply(statement, bindings).run();

  /* 停用或改密碼：讓對方所有裝置重新登入（改自己密碼則保留目前登入） */
  if (logoutUser && id !== staff.id) {
    await deleteStaffSessions(env, id);
  }

  await writeAuditLog(env, staff, "update", "staff_users", id, {
    fields: assignments.length
  });

  return jsonResponse({ success: true, data: await getStaffRecord(env, id) });

}