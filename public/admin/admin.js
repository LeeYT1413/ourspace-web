/* =========================================================
   OURSPACE / 窩室
   後台管理前端
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";


  /* =======================================================
     01. 選項文字
  ======================================================= */

  var ENUMS = {
    newsCategory: [["news", "一般公告"], ["event", "活動"], ["battle", "對戰"], ["store", "商店"]],
    newsStatus: [["published", "已發布"], ["draft", "草稿（不公開）"]],
    activeStatus: [["active", "啟用"], ["inactive", "停用"]],
    tournamentType: [["team", "戰隊賽"], ["solo", "個人賽"]],
    tournamentStatus: [
      ["draft", "草稿（不公開）"],
      ["coming", "即將開放"],
      ["open", "報名中"],
      ["closed", "報名截止"],
      ["ongoing", "進行中"],
      ["finished", "已結束"]
    ],
    matchStatus: [["scheduled", "未開賽"], ["live", "比賽中"], ["paused", "暫停中"], ["finished", "比賽結束"], ["cancelled", "已取消"]],
    matchFormat: [["solo", "個人賽"], ["duo", "雙人賽"], ["trio", "三人賽"]],
    contactStatus: [["unread", "未讀"], ["read", "已讀"], ["done", "已處理"]],
    role: [["referee", "裁判"], ["admin", "管理員"]]
  };


  /*
    戰隊聯賽規則（要和 src/util.js 一致）
    兩隊比分加總上限 9，剛好 9 分才能結束；積分 = 比分差
  */
  var MAX_TOTAL_SCORE = 9;


  var ERROR_MESSAGES = {
    INVALID_CREDENTIALS: "帳號或密碼錯誤。",
    ACCOUNT_LOCKED: "登入失敗太多次，請 15 分鐘後再試。",
    UNAUTHORIZED: "登入已過期，請重新登入。",
    FORBIDDEN: "你的帳號沒有這個權限。",
    CSRF_CHECK_FAILED: "請求被拒絕，請重新整理頁面。",
    SETUP_KEY_NOT_CONFIGURED: "伺服器還沒設定 SETUP_KEY。",
    INVALID_SETUP_KEY: "SETUP_KEY 不正確。",
    ALREADY_SET_UP: "已經有管理員帳號了，請直接登入。",
    INVALID_USERNAME: "帳號需為 3–32 個英文字母、數字或 _ . -",
    INVALID_DISPLAY_NAME: "請填寫顯示名稱（50 字以內）。",
    WEAK_PASSWORD: "密碼至少需要 8 個字元。",
    REQUIRED: "這個欄位必填。",
    TOO_LONG: "內容太長。",
    INVALID_NUMBER: "請輸入有效的整數。",
    INVALID_REFERENCE: "請重新選擇。",
    INVALID_OPTION: "請重新選擇。",
    INVALID_DATETIME: "請輸入完整的日期和時間。",
    INVALID_URL: "網址需以 https:// 或 / 開頭。",
    SAME_TEAM: "A 隊和 B 隊不能是同一隊。",
    DUPLICATE: "已有相同的資料（代碼或帳號重複）。",
    IN_USE_OR_INVALID_REFERENCE: "這筆資料正被其他資料使用（例如賽程用到這個戰隊），無法刪除。",
    CANNOT_DELETE_SELF: "不能刪除自己的帳號。",
    CANNOT_DEMOTE_SELF: "不能把自己改成裁判。",
    CANNOT_DISABLE_SELF: "不能停用自己的帳號。",
    MATCH_NOT_LIVE: "比賽不在進行中（未開始或暫停中），無法加減分。",
    SCORE_LIMIT: "兩隊比分加總已達 9 分上限。",
    SCORE_OVER_LIMIT: "兩隊比分加總不能超過 9 分。",
    SCORE_NOT_COMPLETE: "兩隊比分加總要剛好 9 分才能結束比賽。",
    INVALID_MATCH_STATE: "比賽狀態已被其他人更新，畫面已重新整理。",
    DATABASE_NOT_READY: "資料庫還沒建立後台資料表，請先執行 migration。",
    NETWORK_ERROR: "連線失敗，請檢查網路後再試。"
  };


  /* =======================================================
     02. 資料表設定（列表欄位 + 表單欄位）
  ======================================================= */

  var RESOURCES = {

    league_matches: {
      label: "賽程",
      itemName: "比賽",
      endpoint: "/api/admin/league_matches",
      refreshLookups: false,
      hint: "比賽當天的比分建議由裁判在「裁判計分」更新。勝方與積分會依比分自動計算。",
      columns: [
        { label: "時間", value: function (r) { return r.scheduled_at; } },
        { label: "賽事", value: function (r) { return refLabel("tournaments", r.tournament_id); } },
        { label: "賽別", value: function (r) { return enumLabel("matchFormat", r.match_format); } },
        { label: "輪次", value: function (r) { return r.round_number ? "R" + r.round_number : ""; } },
        { label: "對戰", value: function (r) { return refLabel("teams", r.team_a_id) + " vs " + refLabel("teams", r.team_b_id); } },
        { label: "比分", value: function (r) { return r.score_a === null ? "" : r.score_a + " : " + r.score_b; } },
        { label: "狀態", value: function (r) { return enumLabel("matchStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "tournament_id", label: "賽事", type: "ref", ref: "tournaments", required: true },
        { name: "match_format", label: "賽別", type: "select", options: "matchFormat", default: "solo", half: true },
        { name: "scheduled_at", label: "比賽時間", type: "datetime", required: true, half: true },
        { name: "round_number", label: "第幾輪", type: "number", half: true },
        { name: "match_number", label: "第幾場", type: "number", half: true },
        { name: "team_a_id", label: "A 隊", type: "ref", ref: "teams", half: true },
        { name: "team_b_id", label: "B 隊", type: "ref", ref: "teams", half: true },
        { name: "score_a", label: "A 隊分數", type: "number", half: true },
        { name: "score_b", label: "B 隊分數", type: "number", half: true, help: "兩隊加總最多 9 分，結束時要剛好 9 分" },
        { name: "status", label: "狀態", type: "select", options: "matchStatus", default: "scheduled" },
        { name: "field_name", label: "場地", type: "text", placeholder: "例：A 場" },
        { name: "note", label: "備註", type: "text", help: "會顯示在官網比分下方。" }
      ]
    },

    tournaments: {
      label: "賽事",
      itemName: "賽事",
      endpoint: "/api/admin/tournaments",
      refreshLookups: true,
      hint: "狀態設為「草稿」的賽事不會出現在官網。",
      columns: [
        { label: "名稱", value: function (r) { return r.title; } },
        { label: "賽制", value: function (r) { return enumLabel("tournamentType", r.tournament_type); } },
        { label: "開始", value: function (r) { return r.start_at || ""; } },
        { label: "報名費", value: function (r) { return r.entry_fee ? "NT$ " + r.entry_fee : "免費"; } },
        { label: "狀態", value: function (r) { return enumLabel("tournamentStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "title", label: "賽事名稱", type: "text", required: true },
        { name: "tournament_type", label: "賽制", type: "select", options: "tournamentType", required: true, half: true },
        { name: "status", label: "狀態", type: "select", options: "tournamentStatus", default: "draft", half: true },
        { name: "tournament_code", label: "賽事代碼", type: "text", half: true, placeholder: "選填，例：L2026-AUT" },
        { name: "location", label: "地點", type: "text", half: true },
        { name: "start_at", label: "開始時間", type: "datetime", half: true },
        { name: "end_at", label: "結束時間", type: "datetime", half: true },
        { name: "registration_start_at", label: "報名開始", type: "datetime", half: true },
        { name: "registration_end_at", label: "報名截止", type: "datetime", half: true },
        { name: "max_teams", label: "隊伍上限", type: "number", half: true, help: "戰隊賽填這個" },
        { name: "max_players", label: "人數上限", type: "number", half: true, help: "個人賽填這個" },
        { name: "entry_fee", label: "報名費（元）", type: "number", default: 0 },
        { name: "description", label: "賽事說明", type: "textarea", help: "換行會顯示成段落。" },
        { name: "cover_image_url", label: "封面圖片網址", type: "url" }
      ]
    },

    teams: {
      label: "戰隊",
      itemName: "戰隊",
      endpoint: "/api/admin/teams",
      refreshLookups: true,
      columns: [
        { label: "隊名", value: function (r) { return r.team_name; } },
        { label: "代碼", value: function (r) { return r.team_code || ""; } },
        { label: "狀態", value: function (r) { return enumLabel("activeStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "team_name", label: "隊名", type: "text", required: true },
        { name: "team_code", label: "戰隊代碼", type: "text", half: true, placeholder: "選填" },
        { name: "status", label: "狀態", type: "select", options: "activeStatus", default: "active", half: true },
        { name: "team_logo_url", label: "隊徽圖片網址", type: "url" },
        { name: "description", label: "介紹", type: "textarea" }
      ]
    },

    players: {
      label: "選手",
      itemName: "選手",
      endpoint: "/api/admin/players",
      refreshLookups: true,
      columns: [
        { label: "名稱", value: function (r) { return r.player_name; } },
        { label: "暱稱", value: function (r) { return r.nickname || ""; } },
        { label: "戰隊", value: function (r) { return r.team_id ? refLabel("teams", r.team_id) : ""; } },
        { label: "狀態", value: function (r) { return enumLabel("activeStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "player_name", label: "選手名稱", type: "text", required: true, half: true },
        { name: "nickname", label: "暱稱", type: "text", half: true, help: "官網優先顯示暱稱" },
        { name: "team_id", label: "所屬戰隊", type: "ref", ref: "teams", half: true },
        { name: "status", label: "狀態", type: "select", options: "activeStatus", default: "active", half: true },
        { name: "avatar_url", label: "頭像圖片網址", type: "url" }
      ]
    },

    player_ranking: {
      label: "排行榜",
      itemName: "排名",
      endpoint: "/api/admin/player_ranking",
      refreshLookups: false,
      hint: "官網顯示「最近更新的賽季」的前 10 名。",
      columns: [
        { label: "賽季", value: function (r) { return r.season_name; } },
        { label: "名次", value: function (r) { return r.rank_number; } },
        { label: "選手", value: function (r) { return refLabel("players", r.player_id); } },
        { label: "上位", value: function (r) { return r.upper_count; } },
        { label: "勝場", value: function (r) { return r.win_count; } },
        { label: "積分", value: function (r) { return r.points; } }
      ],
      fields: [
        { name: "season_name", label: "賽季名稱", type: "text", required: true, placeholder: "例：2026 Season 01", half: true },
        { name: "rank_number", label: "名次", type: "number", required: true, half: true },
        { name: "player_id", label: "選手", type: "ref", ref: "players", required: true },
        { name: "upper_count", label: "上位次數", type: "number", default: 0, third: true },
        { name: "win_count", label: "勝場", type: "number", default: 0, third: true },
        { name: "points", label: "積分", type: "number", default: 0, third: true }
      ]
    },

    news: {
      label: "公告",
      itemName: "公告",
      endpoint: "/api/admin/news",
      refreshLookups: false,
      columns: [
        { label: "發布時間", value: function (r) { return r.published_at || ""; } },
        { label: "標題", value: function (r) { return r.title; } },
        { label: "分類", value: function (r) { return enumLabel("newsCategory", r.category); } },
        { label: "狀態", value: function (r) { return enumLabel("newsStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "title", label: "標題", type: "text", required: true },
        { name: "category", label: "分類", type: "select", options: "newsCategory", default: "news", half: true },
        { name: "status", label: "狀態", type: "select", options: "newsStatus", default: "published", half: true },
        { name: "published_at", label: "發布時間", type: "datetime", half: true, help: "留空會用儲存當下的時間" },
        { name: "sort_order", label: "排序", type: "number", default: 0, half: true, help: "數字越小越前面" },
        { name: "summary", label: "摘要", type: "textarea", rows: 2, help: "顯示在公告列表" },
        { name: "content", label: "內文", type: "textarea", rows: 8, help: "換行會顯示成段落。" },
        { name: "cover_image_url", label: "封面圖片網址", type: "url" }
      ]
    },

    news_images: {
      label: "輪播照片",
      itemName: "照片",
      endpoint: "/api/admin/news_images",
      refreshLookups: false,
      hint: "沒有任何啟用的照片時，官網會顯示預設畫面。",
      columns: [
        { label: "排序", value: function (r) { return r.sort_order; } },
        { label: "標題", value: function (r) { return r.title || "（無標題）"; } },
        { label: "圖片", value: function (r) { return r.image_url; }, truncate: true },
        { label: "狀態", value: function (r) { return enumLabel("activeStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "image_url", label: "圖片網址", type: "url", required: true, help: "建議比例 16:7" },
        { name: "title", label: "標題", type: "text", half: true },
        { name: "subtitle", label: "副標", type: "text", half: true },
        { name: "link_url", label: "點擊後前往", type: "url", help: "選填，例：/#tournaments" },
        { name: "sort_order", label: "排序", type: "number", default: 0, half: true },
        { name: "status", label: "狀態", type: "select", options: "activeStatus", default: "active", half: true }
      ]
    },

    contact_messages: {
      label: "聯絡訊息",
      itemName: "訊息",
      endpoint: "/api/admin/contact_messages",
      allowCreate: false,
      refreshLookups: false,
      columns: [
        { label: "時間", value: function (r) { return utcToTaiwan(r.created_at); } },
        { label: "姓名", value: function (r) { return r.name || ""; } },
        { label: "聯絡方式", value: function (r) { return r.contact || ""; } },
        { label: "內容", value: function (r) { return r.message; }, truncate: true },
        { label: "狀態", value: function (r) { return enumLabel("contactStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "name", label: "姓名", type: "readonly" },
        { name: "contact", label: "聯絡方式", type: "readonly" },
        { name: "message", label: "內容", type: "readonly" },
        { name: "status", label: "處理狀態", type: "select", options: "contactStatus" }
      ]
    },

    staff: {
      label: "帳號",
      itemName: "帳號",
      endpoint: "/api/admin/staff",
      refreshLookups: false,
      hint: "裁判只能使用「裁判計分」。停用帳號或改密碼後，對方會被登出。",
      columns: [
        { label: "帳號", value: function (r) { return r.username; } },
        { label: "顯示名稱", value: function (r) { return r.display_name; } },
        { label: "角色", value: function (r) { return enumLabel("role", r.role); } },
        { label: "最後登入", value: function (r) { return utcToTaiwan(r.last_login_at); } },
        { label: "狀態", value: function (r) { return enumLabel("activeStatus", r.status); }, badge: "status" }
      ],
      fields: [
        { name: "username", label: "帳號", type: "text", required: true, createOnly: true, help: "3–32 個英文字母、數字或 _ . -" },
        { name: "display_name", label: "顯示名稱", type: "text", required: true },
        { name: "role", label: "角色", type: "select", options: "role", default: "referee", half: true },
        { name: "status", label: "狀態", type: "select", options: "activeStatus", default: "active", half: true },
        { name: "password", label: "密碼", type: "password", requiredOnCreate: true, help: "至少 8 個字元。編輯時留空表示不修改。" }
      ]
    }

  };


  var TABS = [
    { id: "referee", label: "裁判計分", roles: ["admin", "referee"] },
    { id: "league_matches", label: "賽程", roles: ["admin"] },
    { id: "tournaments", label: "賽事", roles: ["admin"] },
    { id: "teams", label: "戰隊", roles: ["admin"] },
    { id: "players", label: "選手", roles: ["admin"] },
    { id: "player_ranking", label: "排行榜", roles: ["admin"] },
    { id: "news", label: "公告", roles: ["admin"] },
    { id: "news_images", label: "輪播照片", roles: ["admin"] },
    { id: "contact_messages", label: "聯絡訊息", roles: ["admin"] },
    { id: "staff", label: "帳號", roles: ["admin"] }
  ];


  /* =======================================================
     03. 狀態
  ======================================================= */

  var state = {
    staff: null,
    lookups: { teams: [], tournaments: [], players: [] },
    currentTab: null,
    records: {}
  };


  /* =======================================================
     04. 工具
  ======================================================= */

  function byId(id) {
    return document.getElementById(id);
  }


  function el(tag, className, text) {

    var node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  }


  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }


  function button(text, className, onClick) {

    var node = el("button", className, text);

    node.type = "button";

    if (onClick) {
      node.addEventListener("click", onClick);
    }

    return node;
  }


  function pad2(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }


  function enumLabel(key, value) {

    var options = ENUMS[key] || [];

    for (var i = 0; i < options.length; i++) {
      if (options[i][0] === value) {
        return options[i][1];
      }
    }

    return value || "";
  }


  function refOptions(ref) {

    var list = state.lookups[ref] || [];

    return list.map(function (item) {

      if (ref === "teams") {
        return [String(item.id), item.team_name];
      }

      if (ref === "tournaments") {
        return [String(item.id), item.title];
      }

      return [
        String(item.id),
        item.nickname ? item.player_name + "（" + item.nickname + "）" : item.player_name
      ];
    });
  }


  function refLabel(ref, id) {

    if (id === null || id === undefined || id === "") {
      return "待定";
    }

    var options = refOptions(ref);

    for (var i = 0; i < options.length; i++) {
      if (options[i][0] === String(id)) {
        return options[i][1];
      }
    }

    return "#" + id;
  }


  /* 資料庫 CURRENT_TIMESTAMP 是 UTC，顯示時轉台灣時間 */
  function utcToTaiwan(value) {

    if (!value) {
      return "";
    }

    var date = new Date(String(value).replace(" ", "T") + "Z");

    if (isNaN(date.getTime())) {
      return value;
    }

    date = new Date(date.getTime() + 8 * 3600 * 1000);

    return date.toISOString().slice(0, 16).replace("T", " ");
  }


  function toInputDatetime(value) {
    return value ? String(value).slice(0, 16).replace(" ", "T") : "";
  }


  function errorText(error) {
    return ERROR_MESSAGES[error && error.code] || "發生錯誤（" + ((error && error.code) || "UNKNOWN") + "）";
  }


  var toastTimer = null;

  function toast(message, type) {

    var node = byId("toast");

    node.textContent = message;
    node.className = "toast" + (type ? " toast-" + type : "");
    node.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(function () {
      node.hidden = true;
    }, 2600);
  }


  /* =======================================================
     05. API
  ======================================================= */

  function api(method, path, body) {

    var options = {
      method: method,
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-OurSpace-Admin": "1"
      }
    };

    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    return fetch(path, options)
      .catch(function () {
        var error = new Error("NETWORK_ERROR");
        error.code = "NETWORK_ERROR";
        throw error;
      })
      .then(function (response) {

        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {

            if (response.ok && data && data.success) {
              return data;
            }

            var error = new Error((data && data.error) || ("HTTP_" + response.status));
            error.code = (data && data.error) || ("HTTP_" + response.status);
            error.field = data && data.field;
            error.data = data && data.data;
            error.status = response.status;

            /* 登入過期：回到登入畫面 */
            if (response.status === 401 && state.staff) {
              state.staff = null;
              showView("login");
              toast("登入已過期，請重新登入。", "error");
            }

            throw error;
          });
      });
  }


  /* =======================================================
     06. 畫面切換 / 登入
  ======================================================= */

  function showView(name) {

    byId("viewLoading").hidden = name !== "loading";
    byId("viewLogin").hidden = name !== "login";
    byId("viewSetup").hidden = name !== "setup";
    byId("viewMain").hidden = name !== "main";

    if (name !== "main") {
      stopRefereeTimer();
      closePanel();
    }

    if (name === "login") {
      var input = byId("loginForm").querySelector("input[name=username]");
      setTimeout(function () { input.focus(); }, 50);
    }
  }


  function showFormError(form, message) {

    var box = form.querySelector(".form-error");

    box.textContent = message || "";
    box.hidden = !message;
  }


  function formData(form) {

    var data = {};

    Array.prototype.forEach.call(form.elements, function (input) {
      if (input.name) {
        data[input.name] = input.value;
      }
    });

    return data;
  }


  function setBusy(form, busy) {

    Array.prototype.forEach.call(form.querySelectorAll("button"), function (node) {
      node.disabled = busy;
    });
  }


  byId("loginForm").addEventListener("submit", function (event) {

    event.preventDefault();

    var form = event.currentTarget;
    var data = formData(form);

    showFormError(form, "");
    setBusy(form, true);

    api("POST", "/api/auth/login", { username: data.username, password: data.password })
      .then(function (response) {
        form.reset();
        enterMain(response.staff);
      })
      .catch(function (error) {
        showFormError(form, errorText(error));
      })
      .then(function () {
        setBusy(form, false);
      });
  });


  byId("setupForm").addEventListener("submit", function (event) {

    event.preventDefault();

    var form = event.currentTarget;
    var data = formData(form);

    if (data.password !== data.password_confirm) {
      showFormError(form, "兩次輸入的密碼不一樣。");
      return;
    }

    showFormError(form, "");
    setBusy(form, true);

    api("POST", "/api/auth/setup", {
      setup_key: data.setup_key,
      display_name: data.display_name,
      username: data.username,
      password: data.password
    })
      .then(function (response) {
        form.reset();
        toast("管理員帳號已建立。", "success");
        enterMain(response.staff);
      })
      .catch(function (error) {
        showFormError(form, errorText(error));
      })
      .then(function () {
        setBusy(form, false);
      });
  });


  byId("logoutButton").addEventListener("click", function () {

    api("POST", "/api/auth/logout", {})
      .catch(function () {})
      .then(function () {
        state.staff = null;
        showView("login");
      });
  });


  function availableTabs() {

    return TABS.filter(function (tab) {
      return state.staff && tab.roles.indexOf(state.staff.role) !== -1;
    });
  }


  function enterMain(staff) {

    state.staff = staff;

    byId("userName").textContent = staff.display_name;
    byId("userRole").textContent = enumLabel("role", staff.role);

    renderNav();
    showView("main");

    var ready = staff.role === "admin" ? loadLookups() : Promise.resolve();

    ready.then(function () {
      openTab(tabFromHash());
    });
  }


  function loadLookups() {

    return api("GET", "/api/admin/lookups")
      .then(function (response) {
        state.lookups = response.data;
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  /* =======================================================
     07. 分頁
  ======================================================= */

  function tabFromHash() {

    var id = (window.location.hash || "").replace("#", "");
    var tabs = availableTabs();

    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === id) {
        return id;
      }
    }

    return tabs.length ? tabs[0].id : null;
  }


  function renderNav() {

    var nav = byId("adminNav");

    clear(nav);

    var tabs = availableTabs();

    /* 只有一個分頁（裁判）就不顯示選單 */
    nav.hidden = tabs.length <= 1;

    tabs.forEach(function (tab) {

      var link = el("a", "tab", tab.label);

      link.href = "#" + tab.id;
      link.setAttribute("data-tab", tab.id);

      nav.appendChild(link);
    });
  }


  function openTab(tabId) {

    if (!tabId) {
      return;
    }

    state.currentTab = tabId;

    Array.prototype.forEach.call(byId("adminNav").querySelectorAll(".tab"), function (link) {

      var active = link.getAttribute("data-tab") === tabId;

      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
        if (link.scrollIntoView) {
          link.scrollIntoView({ block: "nearest", inline: "center" });
        }
      } else {
        link.removeAttribute("aria-current");
      }
    });

    stopRefereeTimer();
    closePanel();

    if (tabId === "referee") {
      renderRefereeView();
    } else {
      renderResourceView(tabId);
    }
  }


  window.addEventListener("hashchange", function () {

    if (state.staff) {
      openTab(tabFromHash());
    }
  });


  /* =======================================================
     08. 資料表列表
  ======================================================= */

  function renderResourceView(resourceId) {

    var config = RESOURCES[resourceId];
    var main = byId("adminMain");

    clear(main);

    var head = el("div", "view-head");
    head.appendChild(el("h1", null, config.label));

    var tools = el("div", "view-tools");

    var search = el("input", "search");
    search.type = "search";
    search.placeholder = "搜尋" + config.label;
    search.setAttribute("aria-label", "搜尋" + config.label);
    tools.appendChild(search);

    if (config.allowCreate !== false) {
      tools.appendChild(
        button("新增" + config.itemName, "btn btn-primary", function () {
          openForm(resourceId, null);
        })
      );
    }

    head.appendChild(tools);
    main.appendChild(head);

    if (config.hint) {
      main.appendChild(el("p", "view-hint", config.hint));
    }

    var listBox = el("div", "table-wrap");
    main.appendChild(listBox);

    listBox.appendChild(el("p", "empty", "載入中…"));

    function draw() {

      var keyword = search.value.trim().toLowerCase();
      var rows = state.records[resourceId] || [];

      if (keyword) {
        rows = rows.filter(function (row) {
          return rowText(config, row).indexOf(keyword) !== -1;
        });
      }

      renderTable(listBox, config, resourceId, rows, keyword);
    }

    search.addEventListener("input", draw);

    api("GET", config.endpoint)
      .then(function (response) {

        state.records[resourceId] = response.data || [];

        if (state.currentTab === resourceId) {
          draw();
        }
      })
      .catch(function (error) {
        clear(listBox);
        listBox.appendChild(el("p", "empty empty-error", errorText(error)));
      });
  }


  function rowText(config, row) {

    return config.columns
      .map(function (column) {
        return String(column.value(row));
      })
      .join(" ")
      .toLowerCase();
  }


  function renderTable(container, config, resourceId, rows, keyword) {

    clear(container);

    if (!rows.length) {
      container.appendChild(
        el(
          "p",
          "empty",
          keyword
            ? "找不到符合的資料。"
            : "還沒有任何" + config.itemName + (config.allowCreate === false ? "。" : "，按「新增" + config.itemName + "」開始。")
        )
      );
      return;
    }

    var table = el("table", "table");
    var thead = el("thead");
    var headRow = el("tr");

    config.columns.forEach(function (column) {
      headRow.appendChild(el("th", null, column.label));
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody");

    rows.forEach(function (row) {

      var tr = el("tr", "row");

      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "編輯");

      config.columns.forEach(function (column) {

        var value = column.value(row);
        var td = el("td", column.truncate ? "cell-truncate" : null);

        if (column.badge) {
          td.appendChild(el("span", "badge badge-" + String(row.status || "").toLowerCase(), value));
        } else {
          td.textContent = value === null || value === undefined ? "" : String(value);
        }

        tr.appendChild(td);
      });

      function edit() {
        openForm(resourceId, row);
      }

      tr.addEventListener("click", edit);

      tr.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          edit();
        }
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }


  /* =======================================================
     09. 編輯表單
  ======================================================= */

  var panel = byId("formPanel");
  var recordForm = byId("recordForm");
  var formFields = byId("formFields");
  var deleteButton = byId("deleteButton");
  var formContext = null;


  function openForm(resourceId, record) {

    var config = RESOURCES[resourceId];
    var isCreate = !record;

    formContext = { resourceId: resourceId, record: record };

    byId("formTitle").textContent = (isCreate ? "新增" : "編輯") + config.itemName;

    clear(formFields);
    showFormError(recordForm, "");

    config.fields.forEach(function (field) {

      if (field.createOnly && !isCreate) {
        formFields.appendChild(createReadonlyField(field, record[field.name]));
        return;
      }

      if (field.type === "readonly") {
        if (record) {
          formFields.appendChild(createReadonlyField(field, record[field.name]));
        }
        return;
      }

      var value = record ? record[field.name] : field.default;

      formFields.appendChild(createField(field, value, isCreate));
    });

    deleteButton.hidden = isCreate;

    panel.hidden = false;
    document.body.classList.add("panel-open");

    var first = formFields.querySelector("input, select, textarea");

    if (first) {
      setTimeout(function () { first.focus(); }, 50);
    }
  }


  function closePanel() {

    if (panel.hidden) {
      return;
    }

    panel.hidden = true;
    document.body.classList.remove("panel-open");
    formContext = null;
  }


  function fieldClass(field) {

    if (field.half) {
      return "field field-half";
    }

    if (field.third) {
      return "field field-third";
    }

    return "field";
  }


  function createReadonlyField(field, value) {

    var wrapper = el("div", fieldClass(field));

    wrapper.appendChild(el("span", "field-label", field.label));
    wrapper.appendChild(el("div", "field-readonly", value || "—"));

    return wrapper;
  }


  function createField(field, value, isCreate) {

    var wrapper = el("label", fieldClass(field));
    var required = field.required || (field.requiredOnCreate && isCreate);

    wrapper.appendChild(el("span", "field-label", field.label + (required ? " *" : "")));

    var input;

    if (field.type === "select" || field.type === "ref") {

      input = el("select");

      var options = field.type === "select" ? ENUMS[field.options] : refOptions(field.ref);

      var hasValue = value !== null && value !== undefined && value !== "";

      if (field.type === "ref" || !hasValue) {
        var empty = el("option", null, field.required ? "— 請選擇 —" : "— 未選擇 —");
        empty.value = "";
        input.appendChild(empty);
      }

      options.forEach(function (option) {
        var node = el("option", null, option[1]);
        node.value = option[0];
        input.appendChild(node);
      });

      input.value = value === null || value === undefined ? "" : String(value);

    } else if (field.type === "textarea") {

      input = el("textarea");
      input.rows = field.rows || 5;
      input.value = value || "";

    } else {

      input = el("input");

      if (field.type === "number") {
        input.type = "number";
        input.inputMode = "numeric";
        input.step = "1";
      } else if (field.type === "datetime") {
        input.type = "datetime-local";
      } else if (field.type === "url") {
        input.type = "text";
        input.inputMode = "url";
        input.placeholder = field.placeholder || "https://…";
      } else if (field.type === "password") {
        input.type = "password";
        input.autocomplete = "new-password";
      } else {
        input.type = "text";
      }

      if (field.type === "datetime") {
        input.value = toInputDatetime(value);
      } else if (field.type !== "password") {
        input.value = value === null || value === undefined ? "" : String(value);
      }
    }

    input.name = field.name;

    if (field.placeholder && field.type !== "url") {
      input.placeholder = field.placeholder;
    }

    if (required) {
      input.required = true;
    }

    wrapper.appendChild(input);

    if (field.help) {
      wrapper.appendChild(el("span", "field-help", field.help));
    }

    return wrapper;
  }


  function collectForm(config, isCreate) {

    var data = {};

    config.fields.forEach(function (field) {

      if (field.type === "readonly" || (field.createOnly && !isCreate)) {
        return;
      }

      var input = recordForm.elements[field.name];

      if (!input) {
        return;
      }

      /* 編輯時密碼留空 = 不修改 */
      if (field.type === "password" && !isCreate && !input.value) {
        return;
      }

      data[field.name] = input.value;
    });

    return data;
  }


  function markFieldError(fieldName) {

    Array.prototype.forEach.call(recordForm.querySelectorAll(".field-invalid"), function (node) {
      node.classList.remove("field-invalid");
    });

    if (!fieldName || !recordForm.elements[fieldName]) {
      return;
    }

    var input = recordForm.elements[fieldName];
    var wrapper = input.closest(".field");

    if (wrapper) {
      wrapper.classList.add("field-invalid");
    }

    input.focus();
  }


  function fieldLabel(config, name) {

    for (var i = 0; i < config.fields.length; i++) {
      if (config.fields[i].name === name) {
        return config.fields[i].label;
      }
    }

    return "";
  }


  recordForm.addEventListener("submit", function (event) {

    event.preventDefault();

    if (!formContext) {
      return;
    }

    var context = formContext;
    var config = RESOURCES[context.resourceId];
    var isCreate = !context.record;
    var data = collectForm(config, isCreate);

    showFormError(recordForm, "");
    markFieldError(null);
    setBusy(recordForm, true);

    var request = isCreate
      ? api("POST", config.endpoint, data)
      : api("PUT", config.endpoint + "/" + context.record.id, data);

    request
      .then(function () {

        closePanel();
        toast(isCreate ? "已新增。" : "已儲存。", "success");

        var after = config.refreshLookups ? loadLookups() : Promise.resolve();

        after.then(function () {
          if (state.currentTab === context.resourceId) {
            renderResourceView(context.resourceId);
          }
        });
      })
      .catch(function (error) {

        var label = fieldLabel(config, error.field);

        showFormError(recordForm, (label ? "「" + label + "」" : "") + errorText(error));
        markFieldError(error.field);
      })
      .then(function () {
        setBusy(recordForm, false);
      });
  });


  deleteButton.addEventListener("click", function () {

    if (!formContext || !formContext.record) {
      return;
    }

    var context = formContext;
    var config = RESOURCES[context.resourceId];

    if (!window.confirm("確定要刪除這筆" + config.itemName + "嗎？刪除後無法復原。")) {
      return;
    }

    setBusy(recordForm, true);

    api("DELETE", config.endpoint + "/" + context.record.id)
      .then(function () {

        closePanel();
        toast("已刪除。", "success");

        var after = config.refreshLookups ? loadLookups() : Promise.resolve();

        after.then(function () {
          renderResourceView(context.resourceId);
        });
      })
      .catch(function (error) {
        showFormError(recordForm, errorText(error));
      })
      .then(function () {
        setBusy(recordForm, false);
      });
  });


  panel.addEventListener("click", function (event) {

    if (event.target.closest("[data-panel-close]")) {
      closePanel();
    }
  });


  document.addEventListener("keydown", function (event) {

    if (event.key === "Escape") {
      closePanel();
    }
  });


  /* =======================================================
     10. 裁判計分
  ======================================================= */

  var referee = {
    date: "",
    today: "",
    timer: null,
    pending: 0,
    pendingById: {},
    list: null,
    chips: null,
    dateInput: null
  };


  function stopRefereeTimer() {

    if (referee.timer) {
      clearInterval(referee.timer);
      referee.timer = null;
    }
  }


  function renderRefereeView() {

    var main = byId("adminMain");

    clear(main);

    var head = el("div", "view-head");
    head.appendChild(el("h1", null, "裁判計分"));

    var tools = el("div", "view-tools");

    var dateInput = el("input", "date-input");
    dateInput.type = "date";
    dateInput.setAttribute("aria-label", "比賽日期");
    dateInput.addEventListener("change", function () {
      referee.date = dateInput.value;
      loadRefereeMatches();
    });

    tools.appendChild(dateInput);

    tools.appendChild(
      button("今天", "btn btn-ghost", function () {
        referee.date = "";
        loadRefereeMatches();
      })
    );

    tools.appendChild(
      button("重新整理", "btn btn-ghost", function () {
        loadRefereeMatches();
      })
    );

    head.appendChild(tools);
    main.appendChild(head);

    referee.chips = el("div", "date-chips");
    main.appendChild(referee.chips);

    referee.list = el("div", "ref-list");
    referee.list.appendChild(el("p", "empty", "載入中…"));
    main.appendChild(referee.list);

    referee.dateInput = dateInput;

    loadRefereeMatches();

    /* 每 10 秒同步一次（看到其他裁判的更新）；操作中不刷新 */
    referee.timer = setInterval(function () {
      if (!document.hidden && referee.pending === 0 && panel.hidden) {
        loadRefereeMatches(true);
      }
    }, 10000);
  }


  function loadRefereeMatches(silent) {

    var path = "/api/referee/matches";

    if (referee.date) {
      path += "?date=" + encodeURIComponent(referee.date);
    }

    return api("GET", path)
      .then(function (response) {

        if (state.currentTab !== "referee" || referee.pending > 0) {
          return;
        }

        referee.date = response.date;
        referee.today = response.today;
        referee.dateInput.value = response.date;

        renderDateChips(response.dates || []);
        renderRefereeList(response.data || []);
      })
      .catch(function (error) {
        if (!silent) {
          clear(referee.list);
          referee.list.appendChild(el("p", "empty empty-error", errorText(error)));
        }
      });
  }


  function renderDateChips(dates) {

    clear(referee.chips);

    dates.forEach(function (date) {

      var label = date.slice(5).replace("-", "/");

      if (date === referee.today) {
        label += " 今天";
      }

      var chip = button(label, "chip" + (date === referee.date ? " active" : ""), function () {
        referee.date = date;
        loadRefereeMatches();
      });

      referee.chips.appendChild(chip);
    });
  }


  function renderRefereeList(matches) {

    clear(referee.list);

    if (!matches.length) {
      referee.list.appendChild(
        el("p", "empty", "這一天沒有比賽。可以從上方切換日期，或到「賽程」新增比賽。")
      );
      return;
    }

    matches.forEach(function (match) {
      referee.list.appendChild(createRefereeCard(match));
    });
  }


  function matchTime(match) {
    return String(match.scheduled_at || "").slice(11, 16);
  }


  function scoreTotal(match) {
    return (Number(match.score_a) || 0) + (Number(match.score_b) || 0);
  }


  function totalText(match) {

    var total = scoreTotal(match);

    return "比分合計 " + total + " / " + MAX_TOTAL_SCORE +
      (total >= MAX_TOTAL_SCORE ? "，可以結束比賽" : "（滿 " + MAX_TOTAL_SCORE + " 分才能結束）");
  }


  function createRefereeCard(match) {

    var card = el("article", "ref-card status-" + match.status);

    card.setAttribute("data-match-id", match.id);


    /* 標頭：時間、賽別、場地、狀態 */
    var head = el("div", "ref-head");

    var meta = el("div", "ref-meta");
    var metaParts = [matchTime(match)];

    if (match.scheduled_at && match.scheduled_at.slice(0, 10) !== referee.date) {
      metaParts[0] = match.scheduled_at.slice(5, 16).replace("-", "/");
    }

    if (match.match_format) {
      metaParts.push(enumLabel("matchFormat", match.match_format));
    }

    if (match.field_name) {
      metaParts.push(match.field_name);
    }

    if (match.round_number) {
      metaParts.push("第 " + match.round_number + " 輪");
    }

    meta.appendChild(el("strong", null, metaParts.join("　")));

    if (match.tournament_title) {
      meta.appendChild(el("span", null, match.tournament_title));
    }

    head.appendChild(meta);
    head.appendChild(el("span", "badge badge-" + match.status, enumLabel("matchStatus", match.status)));

    card.appendChild(head);


    /* 兩隊比分 */
    var isLive = match.status === "live";
    var isPaused = match.status === "paused";

    card.appendChild(createScoreRow(card, match, "a", isLive));
    card.appendChild(createScoreRow(card, match, "b", isLive));

    if (isLive || isPaused) {

      var total = el("div", "ref-total", totalText(match));

      total.classList.toggle("is-full", scoreTotal(match) >= MAX_TOTAL_SCORE);
      card.appendChild(total);
    }


    /* 動作 */
    var actions = el("div", "ref-actions");

    if (match.status === "scheduled") {

      actions.appendChild(
        button("開始比賽", "btn btn-primary btn-block", function () {
          changeStatus(card, match, "start");
        })
      );

    } else if (isLive || isPaused) {

      if (isLive) {
        actions.appendChild(
          button("暫停", "btn btn-ghost", function () {
            changeStatus(card, match, "pause");
          })
        );
      } else {
        actions.appendChild(
          button("繼續比賽", "btn btn-primary", function () {
            changeStatus(card, match, "resume");
          })
        );
      }

      var finishButton = button("結束比賽", "btn btn-danger btn-grow ref-finish", function () {
        confirmFinish(card, match);
      });

      /* 比分加總滿 9 分才能按 */
      finishButton.disabled = scoreTotal(match) !== MAX_TOTAL_SCORE;

      actions.appendChild(finishButton);

    } else if (match.status === "finished") {

      var winner = match.winner_team_id
        ? (match.winner_team_id === match.team_a_id ? match.team_a_name : match.team_b_name) + " 勝"
        : "平手";

      actions.appendChild(el("p", "ref-result", "已結束，" + winner));

      actions.appendChild(
        button("重新開啟", "btn btn-ghost", function () {
          if (window.confirm("重新開啟後可以再修改比分，積分會先移除，再次結束時重新計算。確定嗎？")) {
            changeStatus(card, match, "reopen");
          }
        })
      );

    } else {

      actions.appendChild(el("p", "ref-result", "此比賽已取消。"));
    }

    card.appendChild(actions);

    return card;
  }


  /* 結束前確認：顯示比分與積分變化（積分 = 比分差） */
  function confirmFinish(card, match) {

    /* 加減分還在送出中，等同步完成再結束，避免用到舊比分 */
    if (referee.pendingById[match.id] > 0) {
      toast("比分同步中，請稍候再按一次。", "error");
      return;
    }

    if (scoreTotal(match) !== MAX_TOTAL_SCORE) {
      toast(ERROR_MESSAGES.SCORE_NOT_COMPLETE, "error");
      return;
    }

    var a = Number(match.score_a) || 0;
    var b = Number(match.score_b) || 0;
    var nameA = match.team_a_name || "A 隊";
    var nameB = match.team_b_name || "B 隊";
    var winnerName = a > b ? nameA : nameB;
    var loserName = a > b ? nameB : nameA;
    var diff = Math.abs(a - b);

    var result =
      "勝方：" + winnerName + "\n積分：" +
      winnerName + " +" + diff + "、" +
      loserName + " −" + diff;

    var message =
      "確定結束比賽？\n\n" +
      nameA + "  " + a + " : " + b + "  " + nameB +
      "\n" + result;

    if (window.confirm(message)) {
      changeStatus(card, match, "finish");
    }
  }


  function createScoreRow(card, match, side, isLive) {

    var teamId = match["team_" + side + "_id"];
    var name = match["team_" + side + "_name"] || "待定";
    var isWinner = match.status === "finished" && teamId && match.winner_team_id === teamId;

    var row = el("div", "ref-team" + (isWinner ? " is-winner" : ""));

    row.appendChild(el("div", "ref-team-name", name));

    var controls = el("div", "ref-controls");

    var minus = button("−", "ref-btn ref-minus");
    minus.setAttribute("aria-label", name + " 減 1 分");

    var scoreValue = match["score_" + side];
    var score = el("output", "ref-score", scoreValue === null || scoreValue === undefined ? "–" : scoreValue);
    score.setAttribute("aria-label", name + " 分數");

    var plus = button("+", "ref-btn ref-plus");
    plus.setAttribute("aria-label", name + " 加 1 分");

    minus.disabled = !isLive;
    plus.disabled = !isLive || scoreTotal(match) >= MAX_TOTAL_SCORE;

    minus.addEventListener("click", function () {
      changeScore(card, match, side, -1, score);
    });

    plus.addEventListener("click", function () {
      changeScore(card, match, side, 1, score);
    });

    controls.appendChild(minus);
    controls.appendChild(score);
    controls.appendChild(plus);

    row.appendChild(controls);

    return row;
  }


  /* 比分改變後：更新合計文字；滿 9 分時鎖住兩隊的 +、開放「結束比賽」 */
  function updateTotalDisplay(card, match) {

    var full = scoreTotal(match) >= MAX_TOTAL_SCORE;

    Array.prototype.forEach.call(card.querySelectorAll(".ref-plus"), function (node) {
      node.disabled = full;
    });

    var finishButton = card.querySelector(".ref-finish");

    if (finishButton) {
      finishButton.disabled = scoreTotal(match) !== MAX_TOTAL_SCORE;
    }

    var total = card.querySelector(".ref-total");

    if (total) {
      total.textContent = totalText(match);
      total.classList.toggle("is-full", full);
    }
  }


  /*
    加減分：畫面先立即更新（不用等網路），
    伺服器用原子加減，所有請求完成後再抓一次最新資料校正。
  */
  function changeScore(card, match, side, delta, scoreNode) {

    var key = "score_" + side;
    var current = Number(match[key]) || 0;
    var next = Math.max(0, current + delta);

    if (next === current) {
      return;
    }

    if (delta > 0 && scoreTotal(match) >= MAX_TOTAL_SCORE) {
      toast(ERROR_MESSAGES.SCORE_LIMIT, "error");
      return;
    }

    match[key] = next;
    scoreNode.textContent = String(next);
    updateTotalDisplay(card, match);

    card.classList.add("is-syncing");
    referee.pending += 1;
    referee.pendingById[match.id] = (referee.pendingById[match.id] || 0) + 1;

    if (navigator.vibrate) {
      navigator.vibrate(15);
    }

    api("POST", "/api/referee/matches/" + match.id + "/score", { side: side, delta: delta })
      .catch(function (error) {
        toast(errorText(error), "error");
      })
      .then(function () {

        referee.pending -= 1;
        referee.pendingById[match.id] -= 1;

        /* 這場比賽的請求都完成了，再抓一次最新比分校正 */
        if (referee.pendingById[match.id] === 0) {
          refreshCard(match.id);
        }
      });
  }


  function changeStatus(card, match, action) {

    referee.pending += 1;
    card.classList.add("is-syncing");

    Array.prototype.forEach.call(card.querySelectorAll("button"), function (node) {
      node.disabled = true;
    });

    api("POST", "/api/referee/matches/" + match.id + "/status", { action: action })
      .then(function (response) {

        var labels = {
          start: "比賽開始。",
          pause: "比賽已暫停。",
          resume: "比賽繼續。",
          finish: "比賽結束，積分已計入。",
          reopen: "已重新開啟。"
        };

        toast(labels[action], "success");
        replaceCard(response.data);
      })
      .catch(function (error) {

        toast(errorText(error), "error");

        if (error.data) {
          replaceCard(error.data);
        }
      })
      .then(function () {
        referee.pending -= 1;
      });
  }


  function findCard(matchId) {
    return referee.list
      ? referee.list.querySelector('[data-match-id="' + matchId + '"]')
      : null;
  }


  function refreshCard(matchId) {

    api("GET", "/api/referee/matches/" + matchId)
      .then(function (response) {
        replaceCard(response.data);
      })
      .catch(function () {
        var card = findCard(matchId);
        if (card) {
          card.classList.remove("is-syncing");
        }
      });
  }


  /* 用比賽 id 找到目前畫面上的卡片再替換；還有請求在路上時不替換（避免顯示舊比分） */
  function replaceCard(match) {

    if (referee.pendingById[match.id] > 0) {
      return;
    }

    var card = findCard(match.id);

    if (card && card.parentNode) {
      card.parentNode.replaceChild(createRefereeCard(match), card);
    }
  }


  /* =======================================================
     11. 啟動
  ======================================================= */

  function boot() {

    showView("loading");

    api("GET", "/api/auth/me")
      .then(function (response) {

        if (response.staff) {
          enterMain(response.staff);
        } else if (response.needs_setup) {
          showView("setup");
        } else {
          showView("login");
        }
      })
      .catch(function (error) {

        showView("login");
        showFormError(byId("loginForm"), errorText(error));
      });
  }


  boot();

})();