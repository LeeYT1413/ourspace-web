/* =========================================================
   OURSPACE / 窩室
   後台：場次管理、報到、賽後紀錄、抽獎（扭蛋機）、網站設定
   由 admin.js 呼叫 window.OurSpaceCheckin.render()
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var API = "/api/referee/checkin";
  var STORE_KEY = "os_checkin_event";

  var CAPSULE_COLORS = ["#E9B95A", "#C23A2E", "#8FB4E8", "#7BD39A", "#E9A3A0", "#F1E6D2"];

  var PRESET_FIELDS = [
    { key: "bonus", column: "bonus_text", label: "加碼回饋", ph: "例如：一輪遊的鬥士還可享有…" },
    { key: "rules", column: "rules_text", label: "比賽規則", ph: "例如：瑞士輪 4 輪＋前 8 強單淘汰" },
    { key: "special", column: "special_text", label: "特殊規則", ph: "例如：限定使用指定類別" },
    { key: "notes", column: "notes_text", label: "注意事項", ph: "例如：請提前 30 分鐘報到" }
  ];


  var ERRORS = {
    ARCHIVED: "這個場次已封存，不能再修改。",
    DUPLICATE_NAME: "這個場次已經有相同名稱的報名。",
    DUPLICATE_NUMBER: "參賽號碼重複了，請檢查號碼。",
    INVALID_NAME: "名稱不可空白、最多 50 字，且不能包含 < >。",
    INVALID_TIME: "請輸入正確的時間。",
    INVALID_DATE: "請輸入正確的日期。",
    INVALID_NUMBER: "請輸入正確的數字。",
    EVENT_NOT_FOUND: "找不到這個場次，畫面已重新整理。",
    ENTRY_NOT_FOUND: "找不到這筆報名，畫面已重新整理。",
    NOTHING_TO_IMPORT: "沒有可匯入的有效名單。",
    TOO_MANY_LINES: "一次太多筆了，請分批處理。",
    NO_ELIGIBLE: "已經沒有可以抽的人（已報到且還沒中獎）。",
    WIN_NOT_FOUND: "這筆中獎紀錄已不存在。",
    TIER_NOT_FOUND: "這個抽獎門檻已不存在，畫面已重新整理。",
    INVALID_IMAGE: "只能上傳 JPG、PNG 或 WebP 圖片。",
    IMAGE_TOO_LARGE: "圖片太大了，請換一張小一點的。"
  };


  /* =======================================================
     共用
  ======================================================= */

  var A = null;

  var ck = {
    tab: null,
    main: null,
    events: [],
    today: "",
    eventId: null,
    view: "list",
    listGroup: "upcoming",
    sub: "checkin",
    entries: [],
    picked: [],
    searched: "",
    drawing: false,
    presets: null
  };


  function el(tag, className, text) {
    return A.el(tag, className, text);
  }

  function button(text, className, onClick) {
    return A.button(text, className, onClick);
  }

  function clear(node) {
    A.clear(node);
  }

  function toast(message, type) {
    A.toast(message, type);
  }

  function errorText(error) {
    return ERRORS[error && error.code] || A.errorText(error);
  }

  function api(method, path, body) {
    return A.api(method, API + path, body);
  }

  function role() {
    var staff = A.staff();
    return staff ? staff.role : "";
  }

  function isManager() {
    return role() === "sysadmin" || role() === "admin";
  }

  function canUse(page) {
    var staff = A.staff();
    return !!staff && (staff.pages || []).indexOf(page) !== -1;
  }

  function pad2(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function localToday() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function dateLabel(dateText, timeText) {

    var parts = String(dateText || "").split("-");

    if (parts.length !== 3) {
      return dateText || "";
    }

    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var week = "日一二三四五六".charAt(date.getDay());

    return parts[1] + "/" + parts[2] + "（" + week + "）" + (timeText ? " " + timeText : "");
  }

  function currentEvent() {
    for (var i = 0; i < ck.events.length; i++) {
      if (ck.events[i].id === ck.eventId) {
        return ck.events[i];
      }
    }
    return null;
  }

  function saveSelection() {
    try {
      window.sessionStorage.setItem(STORE_KEY, String(ck.eventId || ""));
    } catch (e) {
      /* 無痕模式等情況，略過 */
    }
  }

  function loadSelection() {
    try {
      return Number(window.sessionStorage.getItem(STORE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function input(type, value, attrs) {

    var node = el("input");

    node.type = type;
    node.value = value === undefined || value === null ? "" : String(value);

    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });

    return node;
  }

  function textarea(value, attrs) {

    var node = el("textarea");

    node.value = value || "";

    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });

    return node;
  }

  function field(label, control, help) {

    var wrap = el("label", "field");

    wrap.appendChild(el("span", "field-label", label));
    wrap.appendChild(control);

    if (help) {
      wrap.appendChild(el("span", "field-help", help));
    }

    return wrap;
  }

  function sectionTitle(text, hint) {

    var box = el("div", "ck-section-title");

    box.appendChild(el("h2", null, text));

    if (hint) {
      box.appendChild(el("p", null, hint));
    }

    return box;
  }

  function segmented(items, current, onPick) {

    var box = el("div", "ck-seg");

    items.forEach(function (item) {
      var node = button(item[1], "ck-seg-btn" + (item[0] === current ? " active" : ""), function () {
        onPick(item[0]);
      });
      node.setAttribute("aria-pressed", item[0] === current ? "true" : "false");
      box.appendChild(node);
    });

    return box;
  }

  function stat(label, value, accent) {

    var box = el("div", "ck-stat" + (accent ? " ck-stat-accent" : ""));

    box.appendChild(el("strong", null, String(value)));
    box.appendChild(el("span", null, label));

    return box;
  }

  function removeButton(label, onClick) {
    var node = button("×", "ck-x", onClick);
    node.setAttribute("aria-label", label);
    return node;
  }

  function lockedBanner(text) {
    return el("div", "ck-locked", "🔒 " + (text || "這個場次已封存，只能查看。要修改請請系統管理員解除封存。"));
  }

  function confirmBox(text) {
    return window.confirm(text);
  }


  /* =======================================================
     入口
  ======================================================= */

  function render(tabId, main) {

    A = window.OurSpaceAdmin;

    ck.tab = tabId;
    ck.main = main;
    ck.picked = [];

    if (tabId !== "events") {
      ck.view = "list";
    }

    clear(main);
    main.appendChild(el("p", "empty", "載入中…"));

    if (tabId === "site_settings") {
      renderSite();
      return;
    }

    loadEvents().then(function () {

      if (tabId === "events") {
        renderEvents();
      } else if (tabId === "lottery") {
        renderLottery();
      } else {
        renderCheckin();
      }
    });
  }


  function stop() {

    closeModal();

    if (lot.wrap) {
      lot.wrap.classList.remove("is-full");
    }

    document.body.classList.remove("lot-full");

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }


  function loadEvents() {

    return api("GET", "/events")
      .then(function (response) {

        ck.events = response.data || [];
        ck.today = response.today || localToday();

        pickDefaultEvent();
      })
      .catch(function (error) {
        ck.events = [];
        toast(errorText(error), "error");
      });
  }


  /* 報到 / 抽獎預設場次：上次選的 → 今天或之後第一場（未封存）→ 最近一場 */
  function pickDefaultEvent() {

    var keep = ck.eventId || loadSelection();
    var i;

    for (i = 0; i < ck.events.length; i++) {
      if (ck.events[i].id === keep) {
        ck.eventId = keep;
        return;
      }
    }

    ck.eventId = null;

    for (i = 0; i < ck.events.length; i++) {
      if (ck.events[i].group === "upcoming") {
        ck.eventId = ck.events[i].id;
        return;
      }
    }

    for (i = 0; i < ck.events.length; i++) {
      if (ck.events[i].group === "pending") {
        ck.eventId = ck.events[i].id;
        return;
      }
    }

    if (ck.events.length) {
      ck.eventId = ck.events[ck.events.length - 1].id;
    }
  }


  function viewHead(title, tools) {

    var head = el("div", "view-head");

    head.appendChild(el("h1", null, title));

    if (tools) {
      head.appendChild(tools);
    }

    return head;
  }


  /* 報到 / 抽獎上方的場次下拉選單 */
  function eventSelect(onChange) {

    var wrap = el("div", "ck-select-wrap");
    var select = el("select", "ck-select");

    select.setAttribute("aria-label", "選擇場次");

    var order = { upcoming: 0, pending: 1, archived: 2 };

    var list = ck.events.slice().sort(function (a, b) {
      return (order[a.group] - order[b.group]) || (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0);
    });

    list.forEach(function (event) {

      var label =
        dateLabel(event.event_date, event.start_time) + "　" + event.title +
        (event.event_date === ck.today ? "・今天" : "") +
        (event.group === "archived" ? "（已封存）" : event.group === "pending" ? "（已結束）" : "");

      var option = el("option", null, label);

      option.value = String(event.id);
      option.selected = event.id === ck.eventId;

      select.appendChild(option);
    });

    select.addEventListener("change", function () {
      ck.eventId = Number(select.value);
      ck.picked = [];
      ck.searched = "";
      saveSelection();
      onChange();
    });

    wrap.appendChild(select);

    return wrap;
  }


  /* =======================================================
     Modal（匯入名單等）
  ======================================================= */

  var modalNode = null;

  function closeModal() {

    if (modalNode && modalNode.parentNode) {
      modalNode.parentNode.removeChild(modalNode);
    }

    modalNode = null;
    document.body.classList.remove("panel-open");
  }


  function openModal(title, bodyNode, footButtons) {

    closeModal();

    var panel = el("div", "panel");
    var backdrop = el("div", "panel-backdrop");
    var sheet = el("div", "panel-sheet");
    var headNode = el("div", "panel-head");

    headNode.appendChild(el("h2", null, title));
    headNode.appendChild(button("×", "icon-button", closeModal));

    var foot = el("div", "panel-foot");

    footButtons.forEach(function (node) {
      foot.appendChild(node);
    });

    sheet.appendChild(headNode);
    sheet.appendChild(bodyNode);
    sheet.appendChild(foot);

    backdrop.addEventListener("click", closeModal);

    panel.appendChild(backdrop);
    panel.appendChild(sheet);

    document.body.appendChild(panel);
    document.body.classList.add("panel-open");

    modalNode = panel;
  }


  /* =======================================================
     圖片上傳（手機上先縮小再上傳）
  ======================================================= */

  function pickAndUploadImage(onDone) {

    var fileInput = input("file", "", { accept: "image/*" });

    fileInput.addEventListener("change", function () {

      var file = fileInput.files && fileInput.files[0];

      if (!file) {
        return;
      }

      toast("圖片處理中…");

      var reader = new FileReader();

      reader.onload = function () {

        var img = new Image();

        img.onload = function () {

          var max = 1400;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");

          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

          var dataUrl = canvas.toDataURL("image/jpeg", 0.82);

          api("POST", "/images", { mime: "image/jpeg", data: dataUrl.split(",")[1] })
            .then(function (response) {
              toast("圖片已上傳。", "success");
              onDone(response.data);
            })
            .catch(function (error) {
              toast(errorText(error), "error");
            });
        };

        img.onerror = function () {
          toast("無法讀取這張圖片。", "error");
        };

        img.src = reader.result;
      };

      reader.readAsDataURL(file);
    });

    fileInput.click();
  }


  /* =======================================================
     場次管理：列表
  ======================================================= */

  function renderEvents() {

    if (ck.view === "edit") {
      renderEventEdit();
      return;
    }

    if (ck.view === "settle") {
      renderSettle();
      return;
    }

    var main = ck.main;

    clear(main);

    var add = button("＋ 新增場次", "btn btn-primary", function () {
      ck.view = "edit";
      ck.editId = null;
      renderEvents();
    });

    main.appendChild(viewHead("場次管理", add));

    var counts = { upcoming: 0, pending: 0, archived: 0 };

    ck.events.forEach(function (event) {
      counts[event.group]++;
    });

    main.appendChild(segmented([
      ["upcoming", "今天與之後 " + counts.upcoming],
      ["pending", "待封存 " + counts.pending],
      ["archived", "已封存 " + counts.archived]
    ], ck.listGroup, function (group) {
      ck.listGroup = group;
      renderEvents();
    }));

    var list = ck.events.filter(function (event) {
      return event.group === ck.listGroup;
    });

    if (ck.listGroup === "archived") {
      list.reverse();
    }

    if (!list.length) {
      main.appendChild(el("p", "empty", ck.listGroup === "upcoming"
        ? "還沒有今天或之後的場次，按「＋ 新增場次」建立一個。"
        : "這裡沒有場次。"));
      return;
    }

    var box = el("div", "ck-cards");

    list.forEach(function (event) {
      box.appendChild(eventCard(event));
    });

    main.appendChild(box);
  }


  function eventCard(event) {

    var card = el("div", "ck-card");
    var tags = el("div", "ck-tags");
    var big = event.event_type === "big";

    tags.appendChild(el("span", "ck-tag " + (big ? "ck-tag-red" : "ck-tag-navy"), big ? "大型賽事" : "日常賽"));

    var statusText = { upcoming: big ? "報名中" : "進行中", pending: "已結束", archived: "已封存" }[event.group];

    /* 大型賽事：額滿或超過開始時間／報名截止，就停止線上報名 */
    if (big && event.group === "upcoming") {

      var nowText = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
      var started = event.start_time && event.event_date + " " + event.start_time <= nowText;
      var pastDeadline = event.reg_deadline && event.reg_deadline.replace("T", " ") < nowText;

      if (event.capacity && Number(event.total) >= Number(event.capacity)) {
        statusText = "額滿";
      } else if (started || pastDeadline) {
        statusText = "報名截止";
      }
    }
    var statusClass = { upcoming: "ck-tag-green", pending: "ck-tag-gold", archived: "ck-tag-brown" }[event.group];

    tags.appendChild(el("span", "ck-tag " + statusClass, statusText));
    tags.appendChild(el("span", "ck-tag-note", Number(event.is_public) === 1 ? "官網公開" : "不公開"));

    card.appendChild(tags);
    card.appendChild(el("strong", "ck-card-title", event.title));
    card.appendChild(el("span", "ck-card-sub", dateLabel(event.event_date, event.start_time) + (event.event_date === ck.today ? "・今天" : "")));

    var stats = el("div", "ck-stats ck-stats-small");

    stats.appendChild(stat(event.capacity ? "報名 / 名額" : "報名", event.capacity ? event.total + "/" + event.capacity : event.total));
    stats.appendChild(stat("已報到", event.checked));
    stats.appendChild(stat("綁定選手", event.linked));

    card.appendChild(stats);

    if (event.group === "archived") {
      card.appendChild(el("div", "ck-card-lock", "🔒 已封存・" + (event.archived_at || "")));
    }

    var actions = el("div", "ck-actions");

    function goCheckin() {
      ck.eventId = event.id;
      saveSelection();
      window.location.hash = "#checkin";
    }

    function goSettle() {
      ck.eventId = event.id;
      ck.view = "settle";
      renderEvents();
    }

    if (event.group !== "archived") {

      if (canUse("checkin")) {
        actions.appendChild(button("報到", "btn btn-ghost", goCheckin));
      }

      actions.appendChild(button("編輯", "btn btn-ghost", function () {
        ck.view = "edit";
        ck.editId = event.id;
        renderEvents();
      }));

      if (event.group === "upcoming") {

        actions.appendChild(button("比賽結束", "btn btn-primary", function () {

          if (!confirmBox("確定「" + event.title + "」比賽結束了嗎？\n接著會打開賽後紀錄。")) {
            return;
          }

          api("POST", "/events/" + event.id + "/end", {})
            .then(function () {
              return loadEvents();
            })
            .then(goSettle)
            .catch(function (error) {
              toast(errorText(error), "error");
            });
        }));

      } else {
        actions.appendChild(button("賽後紀錄", "btn btn-primary", goSettle));
      }

    } else {

      actions.appendChild(button("看賽後紀錄", "btn btn-ghost", goSettle));

      if (role() === "sysadmin") {
        actions.appendChild(button("解除封存", "btn btn-danger", function () {

          if (!confirmBox("解除封存「" + event.title + "」？\n已寫進選手上位紀錄的資料會一起撤回，修改完可以再封存一次。")) {
            return;
          }

          api("POST", "/events/" + event.id + "/unarchive", {})
            .then(function () {
              toast("已解除封存，場次回到「待封存」。", "success");
              ck.listGroup = "pending";
              return loadEvents().then(renderEvents);
            })
            .catch(function (error) {
              toast(errorText(error), "error");
            });
        }));
      }
    }

    card.appendChild(actions);

    return card;
  }


  /* =======================================================
     場次管理：新增 / 編輯
  ======================================================= */

  function loadPresets() {

    if (ck.presets) {
      return Promise.resolve(ck.presets);
    }

    return api("GET", "/site")
      .then(function (response) {
        ck.presets = (response.data && response.data.presets) || {};
        return ck.presets;
      })
      .catch(function () {
        ck.presets = {};
        return ck.presets;
      });
  }


  function renderEventEdit() {

    var main = ck.main;

    clear(main);
    main.appendChild(el("p", "empty", "載入中…"));

    var loadEvent = ck.editId
      ? api("GET", "/events/" + ck.editId).then(function (response) { return response.data; })
      : Promise.resolve(null);

    Promise.all([loadEvent, loadPresets()])
      .then(function (results) {
        drawEventForm(results[0]);
      })
      .catch(function (error) {
        toast(errorText(error), "error");
        ck.view = "list";
        renderEvents();
      });
  }


  function drawEventForm(event) {

    var main = ck.main;
    var isEdit = !!event;

    var form = {
      event_type: isEdit ? event.event_type || "daily" : "big",
      poster_image_id: isEdit ? event.poster_image_id : null,
      poster_url: isEdit ? event.poster_url : null,
      prizes: isEdit
        ? event.prizes.map(function (p) { return { prize: p.prize || "", qty: p.qty || 1 }; })
        : [],
      tiers: isEdit
        ? event.tiers.map(function (t) { return { id: t.id, min_players: t.min_players, prize: t.prize || "", qty: t.qty }; })
        : []
    };

    clear(main);

    var back = button("‹ 場次管理", "btn btn-ghost btn-small", function () {
      ck.view = "list";
      renderEvents();
    });

    main.appendChild(viewHead(isEdit ? "編輯場次" : "新增場次", back));

    var wrap = el("div", "ck-form");

    /* ---------- 類型 ---------- */

    var typeBox = el("div", "ck-block");
    var typeHint = el("p", "field-help");
    var bigBlock = el("div", "ck-block-group");

    function drawType() {

      clear(typeBox);

      typeBox.appendChild(el("span", "field-label", "場次類型"));
      typeBox.appendChild(segmented([["big", "大型賽事"], ["daily", "日常賽"]], form.event_type, function (value) {
        form.event_type = value;
        drawType();
      }));

      typeHint.textContent = form.event_type === "big"
        ? "開放會員在官網線上報名，可以設定報名費、名額、截止時間與海報。"
        : "不開放線上報名，由店員在報到時新增或匯入名單。";

      typeBox.appendChild(typeHint);
      bigBlock.hidden = form.event_type !== "big";
    }

    wrap.appendChild(typeBox);

    /* ---------- 基本資料 ---------- */

    var titleInput = input("text", isEdit ? event.title : "", { maxlength: "50", placeholder: "例如：窩室日常賽" });
    var dateInput = input("date", isEdit ? event.event_date : ck.today);
    /* 新增時預設現在時間往前取整 10 分（例如 20:18 → 20:10） */
    var nowDate = new Date();
    var nowTime = pad2(nowDate.getHours()) + ":" + pad2(Math.floor(nowDate.getMinutes() / 10) * 10);
    var timeInput = A.timeSelect(isEdit ? event.start_time || "" : nowTime, "未定");
    var noteInput = input("text", isEdit ? event.note : "", { maxlength: "200", placeholder: "選填，會顯示在官網" });
    var publicOn = isEdit ? Number(event.is_public) === 1 : true;

    var publicSwitch = button("", "ck-switch-row", function () {
      publicOn = !publicOn;
      drawPublic();
    });

    function drawPublic() {
      clear(publicSwitch);
      publicSwitch.setAttribute("role", "switch");
      publicSwitch.setAttribute("aria-checked", publicOn ? "true" : "false");
      publicSwitch.appendChild(el("span", null, "在官網「賽事名單」公開"));
      publicSwitch.appendChild(el("span", "ck-switch" + (publicOn ? " on" : "")));
    }

    drawPublic();

    var basic = el("div", "ck-block");
    var dateRow = el("div", "ck-row");

    basic.appendChild(sectionTitle("基本資料"));
    basic.appendChild(field("場次名稱", titleInput));
    dateRow.appendChild(field("日期", dateInput));
    dateRow.appendChild(field("開始時間（24 小時制）", timeInput));
    basic.appendChild(dateRow);
    var feeInput = input("number", isEdit ? event.fee : "", { min: "0", inputmode: "numeric" });

    basic.appendChild(field("報名費（元）", feeInput, "賽後紀錄的參賽費用會用這個金額帶入。"));
    basic.appendChild(publicSwitch);

    wrap.appendChild(basic);

    /* ---------- 大型賽事：線上報名 ---------- */

    var capInput = input("number", isEdit ? event.capacity : "", { min: "1", inputmode: "numeric" });
    var deadlineInput = input("hidden", "");
    var deadlinePicker = A.dateTimePicker(deadlineInput, isEdit ? event.reg_deadline : "");

    var feeRow = el("div", "ck-row");

    bigBlock.appendChild(sectionTitle("線上報名"));
    feeRow.appendChild(field("名額上限", capInput));
    bigBlock.appendChild(feeRow);
    bigBlock.appendChild(field("報名截止（24 小時制）", deadlinePicker));
    bigBlock.appendChild(deadlineInput);

    var posterBox = el("div", "ck-poster");

    function drawPoster() {

      clear(posterBox);
      posterBox.appendChild(el("span", "field-label", "比賽海報（選填）"));

      if (form.poster_url) {

        var preview = el("div", "ck-poster-preview");
        var img = el("img");

        img.src = form.poster_url;
        img.alt = "比賽海報預覽";

        preview.appendChild(img);
        preview.appendChild(button("移除", "btn btn-ghost btn-small", function () {
          form.poster_image_id = null;
          form.poster_url = null;
          form.poster_removed = true;
          drawPoster();
        }));

        posterBox.appendChild(preview);

      } else {

        posterBox.appendChild(button("點一下上傳海報\n沒有海報時，官網會改顯示下方的文字說明", "ck-upload", function () {
          pickAndUploadImage(function (image) {
            form.poster_image_id = image.id;
            form.poster_url = image.url;
            drawPoster();
          });
        }));
      }
    }

    drawPoster();
    bigBlock.appendChild(posterBox);

    var textInputs = {};

    PRESET_FIELDS.forEach(function (def) {

      var area = textarea(isEdit ? event[def.column] : "", { rows: "3", placeholder: def.ph });
      var box = el("div", "ck-preset-field");
      var head = el("div", "ck-preset-head");
      var menu = el("div", "ck-preset-menu");

      menu.hidden = true;

      head.appendChild(el("span", "field-label", def.label));

      var plus = button("＋", "ck-plus", function () {

        clear(menu);

        var list = (ck.presets && ck.presets[def.key]) || [];

        if (!list.length) {
          menu.appendChild(el("span", "ck-preset-empty", "還沒有常用內容，可以到「網站設定 → 常用內容」新增。"));
        }

        list.forEach(function (text) {
          menu.appendChild(button(text, "ck-preset-item", function () {
            area.value = area.value ? area.value + "\n" + text : text;
            menu.hidden = true;
            area.focus();
          }));
        });

        menu.hidden = !menu.hidden;
      });

      plus.setAttribute("aria-label", "加入常用的" + def.label);

      head.appendChild(plus);
      box.appendChild(head);
      box.appendChild(menu);
      box.appendChild(area);

      textInputs[def.column] = area;
      bigBlock.appendChild(box);
    });

    wrap.appendChild(bigBlock);

    /* ---------- 比賽獎品 ---------- */

    var prizeBlock = el("div", "ck-block");
    var prizeList = el("div", "ck-list");

    function drawPrizes() {

      clear(prizeList);

      if (!form.prizes.length) {
        prizeList.appendChild(el("p", "field-help", "還沒有獎品。開幾個獎就新增幾個。"));
      }

      form.prizes.forEach(function (item, index) {

        var row = el("div", "ck-inline");
        var prize = input("text", item.prize, { maxlength: "100", placeholder: "獎品名稱", "aria-label": "第 " + (index + 1) + " 個獎品" });

        var qty = input("number", item.qty || 1, { min: "1", inputmode: "numeric", "aria-label": "第 " + (index + 1) + " 個獎品的數量" });

        qty.className = "ck-w-num";

        prize.addEventListener("input", function () { item.prize = prize.value; });
        qty.addEventListener("input", function () { item.qty = Math.max(1, Number(qty.value) || 1); });

        row.appendChild(el("span", "ck-inline-label ck-prize-no", String(index + 1)));
        row.appendChild(prize);
        row.appendChild(el("span", "ck-inline-label", "×"));
        row.appendChild(qty);
        row.appendChild(removeButton("移除這個獎", function () {
          form.prizes.splice(index, 1);
          drawPrizes();
        }));

        prizeList.appendChild(row);
      });
    }

    drawPrizes();

    prizeBlock.appendChild(sectionTitle("比賽獎品", "依序列出這次有哪些獎品和數量。賽後紀錄時，依新增上位者的順序記錄每個人挑了哪個獎品。"));
    prizeBlock.appendChild(prizeList);
    prizeBlock.appendChild(button("＋ 新增獎品", "ck-add-row", function () {
      form.prizes.push({ prize: "", qty: 1 });
      drawPrizes();
    }));

    wrap.appendChild(prizeBlock);

    /* ---------- 抽獎設定 ---------- */

    var tierBlock = el("div", "ck-block");
    var tierList = el("div", "ck-list");

    function drawTiers() {

      clear(tierList);

      if (!form.tiers.length) {
        tierList.appendChild(el("p", "field-help", "沒有設定時，抽獎頁可以直接輸入獎品抽。"));
      }

      form.tiers.forEach(function (tier, index) {

        var card = el("div", "ck-subcard");
        var top = el("div", "ck-inline");
        var min = input("number", tier.min_players, { min: "0", inputmode: "numeric", "aria-label": "抽獎門檻人數" });
        var prize = input("text", tier.prize, { maxlength: "100", placeholder: "抽獎獎品", "aria-label": "抽獎獎品" });
        var qty = input("number", tier.qty, { min: "1", inputmode: "numeric", "aria-label": "名額" });

        min.className = "ck-w-num";
        qty.className = "ck-w-num";

        min.addEventListener("input", function () { tier.min_players = min.value; });
        prize.addEventListener("input", function () { tier.prize = prize.value; });
        qty.addEventListener("input", function () { tier.qty = qty.value; });

        top.appendChild(el("span", "ck-inline-label", "報到滿"));
        top.appendChild(min);
        top.appendChild(el("span", "ck-inline-label ck-grow", "人"));
        top.appendChild(removeButton("移除這個抽獎", function () {
          form.tiers.splice(index, 1);
          drawTiers();
        }));

        var bottom = el("div", "ck-inline");

        bottom.appendChild(prize);
        bottom.appendChild(el("span", "ck-inline-label", "×"));
        bottom.appendChild(qty);

        card.appendChild(top);
        card.appendChild(bottom);
        tierList.appendChild(card);
      });
    }

    drawTiers();

    tierBlock.appendChild(sectionTitle("抽獎設定", "報到人數達到門檻就開放抽對應的獎；人數不足仍可抽，但會先跳提醒。"));
    tierBlock.appendChild(tierList);
    tierBlock.appendChild(button("＋ 新增抽獎門檻", "ck-add-row", function () {
      var last = form.tiers.length ? Number(form.tiers[form.tiers.length - 1].min_players) || 0 : 8;
      form.tiers.push({ id: null, min_players: form.tiers.length ? last + 8 : 16, prize: "", qty: 1 });
      drawTiers();
    }));

    wrap.appendChild(tierBlock);

    /* ---------- 刪除 ---------- */

    /* ---------- 備註（放最下面） ---------- */

    var noteBlock = el("div", "ck-block");
    noteBlock.appendChild(field("備註（選填，會顯示在官網）", noteInput));
    wrap.appendChild(noteBlock);

    if (isEdit && isManager()) {

      var danger = el("div", "ck-block");

      danger.appendChild(button("刪除這個場次", "btn btn-danger btn-block", function () {

        if (!confirmBox("確定要刪除「" + event.title + "」？\n名單、抽獎和賽後紀錄都會一起刪除，無法復原。")) {
          return;
        }

        api("DELETE", "/events/" + event.id)
          .then(function () {
            toast("場次已刪除。", "success");
            ck.view = "list";
            ck.eventId = null;
            return loadEvents().then(renderEvents);
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));

      wrap.appendChild(danger);
    }

    main.appendChild(wrap);

    /* ---------- 底部按鈕 ---------- */

    var bar = el("div", "ck-bottom-bar");

    var saveBtn = button("儲存", "btn btn-primary", function () {

      saveBtn.disabled = true;

      var body = {
        event_type: form.event_type,
        title: titleInput.value,
        event_date: dateInput.value,
        start_time: timeInput.value,
        note: noteInput.value,
        is_public: publicOn ? 1 : 0,
        fee: feeInput.value,
        capacity: capInput.value,
        reg_deadline: deadlineInput.value,
        poster_image_id: form.poster_image_id,
        poster_removed: !!form.poster_removed,
        prizes: form.prizes.map(function (p) { return { prize: p.prize, qty: p.qty || 1 }; }),
        tiers: form.tiers
      };

      PRESET_FIELDS.forEach(function (def) {
        body[def.column] = textInputs[def.column].value;
      });

      api(isEdit ? "PUT" : "POST", isEdit ? "/events/" + event.id : "/events", body)
        .then(function (response) {
          toast(isEdit ? "場次已更新。" : "場次已新增。", "success");
          ck.eventId = response.data.id;
          saveSelection();
          ck.view = "list";
          ck.listGroup = response.data.group || "upcoming";
          return loadEvents().then(renderEvents);
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          saveBtn.disabled = false;
        });
    });

    bar.appendChild(button("取消", "btn btn-ghost", function () {
      ck.view = "list";
      renderEvents();
    }));
    bar.appendChild(saveBtn);

    main.appendChild(bar);

    drawType();
  }


  /* =======================================================
     場次管理：賽後紀錄 / 封存
  ======================================================= */

  function renderSettle() {

    var main = ck.main;

    clear(main);
    main.appendChild(el("p", "empty", "載入中…"));

    api("GET", "/events/" + ck.eventId + "/settle")
      .then(function (response) {
        drawSettle(response.data);
      })
      .catch(function (error) {
        toast(errorText(error), "error");
        ck.view = "list";
        renderEvents();
      });
  }


  function drawSettle(data) {

    var main = ck.main;
    var locked = !!data.event.archived_at;
    var checkedCount = data.checked.length;

    var form = {
      fees: data.fees.map(function (f) { return { label: f.label, price: f.price, count: f.count }; }),
      placements: data.placements.map(function (p) { return { rank_label: p.rank_label, entry_id: p.entry_id, prize: p.prize || "", configs: (p.configs || []).slice() }; }),
      wins: data.wins.map(function (w) { return { id: w.id, prize: w.prize || "", name: (w.checkin_number ? w.checkin_number + "- " : "") + w.nickname }; })
    };

    clear(main);

    var back = button("‹ 場次管理", "btn btn-ghost btn-small", function () {
      ck.view = "list";
      loadEvents().then(renderEvents);
    });

    main.appendChild(viewHead("賽後紀錄", back));

    var summary = el("div", "ck-card ck-card-light");
    var tags = el("div", "ck-tags");

    tags.appendChild(el("span", "ck-tag " + (data.event.event_type === "big" ? "ck-tag-red" : "ck-tag-navy"), data.event.event_type === "big" ? "大型賽事" : "日常賽"));
    tags.appendChild(el("span", "ck-tag " + (locked ? "ck-tag-brown" : "ck-tag-gold"), locked ? "已封存" : "待封存"));

    summary.appendChild(tags);
    summary.appendChild(el("strong", "ck-card-title", data.event.title));
    summary.appendChild(el("span", "ck-card-sub", dateLabel(data.event.event_date, data.event.start_time)));

    var stats = el("div", "ck-stats ck-stats-small");

    stats.appendChild(stat("報名", data.total));
    stats.appendChild(stat("已報到", checkedCount));
    stats.appendChild(stat("綁定選手", data.linked));

    summary.appendChild(stats);
    main.appendChild(summary);

    if (locked) {
      main.appendChild(lockedBanner("已封存（" + data.event.archived_at + "），下面的賽後紀錄只能查看。"));
    }

    var wrap = el("div", "ck-form");

    /* ---------- 參賽費用 ---------- */

    var feeBlock = el("div", "ck-block");
    var feeList = el("div", "ck-list");
    var feeTotal = el("div", "ck-total");

    function drawFeeTotal() {

      var heads = 0;
      var total = 0;

      form.fees.forEach(function (f) {
        heads += Number(f.count) || 0;
        total += (Number(f.price) || 0) * (Number(f.count) || 0);
      });

      clear(feeTotal);

      var left = el("span", null, "合計 " + heads + " 人 ");
      var check = el("span", heads === checkedCount ? "ck-ok" : "ck-warn",
        heads === checkedCount ? "（與已報到人數相符）" : "（已報到 " + checkedCount + " 人，請確認）");

      left.appendChild(check);
      feeTotal.appendChild(left);
      feeTotal.appendChild(el("strong", null, "$ " + total));
    }

    function drawFees() {

      clear(feeList);

      form.fees.forEach(function (fee, index) {

        var row = el("div", "ck-subcard ck-fee-row");
        var label = input("text", fee.label, { maxlength: "20", "aria-label": "價格名稱" });
        var price = input("number", fee.price, { min: "0", inputmode: "numeric", "aria-label": fee.label + "金額" });

        label.className = "ck-w-rank";
        price.className = "ck-w-price";
        label.disabled = locked;
        price.disabled = locked;

        label.addEventListener("input", function () { fee.label = label.value; });
        price.addEventListener("input", function () { fee.price = price.value; drawFeeTotal(); });

        var stepper = el("div", "ck-stepper");
        var count = el("strong", null, fee.count + " 人");

        var dec = button("−", "ck-step", function () {
          fee.count = Math.max(0, (Number(fee.count) || 0) - 1);
          count.textContent = fee.count + " 人";
          drawFeeTotal();
        });

        var inc = button("＋", "ck-step", function () {
          fee.count = (Number(fee.count) || 0) + 1;
          count.textContent = fee.count + " 人";
          drawFeeTotal();
        });

        dec.setAttribute("aria-label", "人數減一");
        inc.setAttribute("aria-label", "人數加一");
        dec.disabled = locked;
        inc.disabled = locked;

        stepper.appendChild(dec);
        stepper.appendChild(count);
        stepper.appendChild(inc);

        row.appendChild(label);
        row.appendChild(el("span", "ck-inline-label", "$"));
        row.appendChild(price);
        row.appendChild(stepper);

        if (!locked && form.fees.length > 1) {
          row.appendChild(removeButton("移除這個價格", function () {
            form.fees.splice(index, 1);
            drawFees();
          }));
        }

        feeList.appendChild(row);
      });

      drawFeeTotal();
    }

    drawFees();

    feeBlock.appendChild(sectionTitle("參賽費用", "幾個人付多少錢，例如原價和各種優惠價。"));
    feeBlock.appendChild(feeList);

    if (!locked) {
      feeBlock.appendChild(button("＋ 新增優惠價", "ck-add-row", function () {
        form.fees.push({ label: "優惠價", price: 0, count: 0 });
        drawFees();
      }));
    }

    feeBlock.appendChild(feeTotal);
    wrap.appendChild(feeBlock);

    /* ---------- 抽獎品發放 ---------- */

    var winBlock = el("div", "ck-block");

    winBlock.appendChild(sectionTitle("抽獎品發放", "從抽獎紀錄自動帶入，獎品預設為抽獎設定的獎品，可以修改。"));

    if (!form.wins.length) {
      winBlock.appendChild(el("p", "field-help", "這個場次沒有抽獎紀錄。"));
    }

    form.wins.forEach(function (win) {

      var row = el("div", "ck-inline ck-subcard");
      var prize = input("text", win.prize, { maxlength: "100", placeholder: "抽獎品", "aria-label": win.name + "的抽獎品" });

      prize.disabled = locked;
      prize.addEventListener("input", function () { win.prize = prize.value; });

      row.appendChild(el("span", "ck-name", win.name));
      row.appendChild(prize);
      winBlock.appendChild(row);
    });

    wrap.appendChild(winBlock);

    /* ---------- 上位者與比賽獎品 ---------- */

    var placeBlock = el("div", "ck-block");
    var placeList = el("div", "ck-list");

    function drawPlacements() {

      clear(placeList);

      form.placements.forEach(function (item, index) {

        var card = el("div", "ck-subcard");
        var top = el("div", "ck-inline");
        var label = input("text", item.rank_label, { maxlength: "20", "aria-label": "名次" });
        var select = el("select", "ck-select ck-grow");

        label.className = "ck-w-rank";
        label.disabled = locked;
        select.disabled = locked;
        select.setAttribute("aria-label", item.rank_label + "選手");

        var empty = el("option", null, "請選擇選手（已報到）");
        empty.value = "";
        select.appendChild(empty);

        data.checked.forEach(function (entry) {
          var option = el("option", null, (entry.checkin_number ? entry.checkin_number + "- " : "") + entry.nickname);
          option.value = String(entry.id);
          option.selected = entry.id === item.entry_id;
          select.appendChild(option);
        });

        label.addEventListener("input", function () { item.rank_label = label.value; });
        select.addEventListener("change", function () { item.entry_id = Number(select.value) || null; });

        top.appendChild(label);
        top.appendChild(select);

        if (!locked) {
          top.appendChild(removeButton("移除這個名次", function () {
            form.placements.splice(index, 1);
            drawPlacements();
          }));
        }

        /* 獎品：依場次設定的順序；被挑完的就不出現 */
        var prize = el("select", "ck-select");
        var optionsList = data.prize_options || [];

        var none = el("option", null, optionsList.length ? "選擇他挑的獎品" : "（這個場次沒有設定獎品）");
        none.value = "";
        prize.appendChild(none);

        var listed = false;

        optionsList.forEach(function (opt) {

          var used = form.placements.filter(function (other) { return other !== item && other.prize === opt.name; }).length;
          var left = opt.qty - used;

          if (left <= 0 && item.prize !== opt.name) {
            return;
          }

          var option = el("option", null, opt.name + (opt.qty > 1 ? "（剩 " + Math.max(0, left) + "）" : ""));
          option.value = opt.name;
          option.selected = opt.name === item.prize;
          listed = listed || option.selected;
          prize.appendChild(option);
        });

        /* 舊資料或手動寫的獎品，保留顯示 */
        if (item.prize && !listed) {
          var keep = el("option", null, item.prize);
          keep.value = item.prize;
          keep.selected = true;
          prize.appendChild(keep);
        }

        prize.disabled = locked;
        prize.setAttribute("aria-label", item.rank_label + "選的獎品");
        prize.addEventListener("change", function () {
          item.prize = prize.value;
          drawPlacements();
        });

        card.appendChild(top);
        card.appendChild(prize);

        /* 配置：可以加好幾個，會跟著存進上位紀錄 */
        item.configs = item.configs || [];

        var configBox = el("div", "ck-configs");

        item.configs.forEach(function (text, ci) {

          var line = el("div", "ck-inline");
          var config = input("text", text, { maxlength: "100", placeholder: "例如：陀螺組合、使用的零件", "aria-label": item.rank_label + "的第 " + (ci + 1) + " 個配置" });

          config.disabled = locked;
          config.addEventListener("input", function () { item.configs[ci] = config.value; });

          line.appendChild(el("span", "ck-inline-label ck-config-label", "配置 " + (ci + 1)));
          line.appendChild(config);

          if (!locked) {
            line.appendChild(removeButton("移除這個配置", function () {
              item.configs.splice(ci, 1);
              drawPlacements();
            }));
          }

          configBox.appendChild(line);
        });

        if (!locked) {
          configBox.appendChild(button("＋ 新增配置", "ck-add-row ck-add-config", function () {
            item.configs.push("");
            drawPlacements();
          }));
        }

        card.appendChild(configBox);
        placeList.appendChild(card);
      });
    }

    drawPlacements();

    placeBlock.appendChild(sectionTitle("上位者與比賽獎品", "依序新增上位者（第 1 位就是第 1 名），再選他挑的獎品；挑完的獎品不會再出現。封存時，有綁選手資料的上位者會寫進排行榜。"));
    placeBlock.appendChild(placeList);

    if (!locked) {
      placeBlock.appendChild(button("＋ 新增上位者", "ck-add-row", function () {
        form.placements.push({ rank_label: "第" + (form.placements.length + 1) + "名", entry_id: null, prize: "", configs: [] });
        drawPlacements();
      }));
    }

    wrap.appendChild(placeBlock);

    /* ---------- 備註 ---------- */

    var noteBlock = el("div", "ck-block");
    var note = textarea(data.note, { rows: "3", placeholder: "例如：其他獎品、現場狀況、補登事項" });

    note.disabled = locked;

    noteBlock.appendChild(sectionTitle("備註"));
    noteBlock.appendChild(note);
    wrap.appendChild(noteBlock);

    main.appendChild(wrap);

    /* ---------- 底部按鈕 ---------- */

    if (locked) {
      return;
    }

    function payload() {
      return { fees: form.fees, placements: form.placements, wins: form.wins, note: note.value };
    }

    var bar = el("div", "ck-bottom-bar ck-bottom-stack");

    var saveBtn = button("儲存紀錄", "btn btn-ghost btn-gold", function () {

      saveBtn.disabled = true;

      api("PUT", "/events/" + ck.eventId + "/settle", payload())
        .then(function () {
          toast("賽後紀錄已儲存。關店點帳後再回來封存。", "success");
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          saveBtn.disabled = false;
        });
    });

    var archiveBtn = button("儲存並封存", "btn btn-primary", function () {

      if (!confirmBox("確定封存「" + data.event.title + "」？\n封存後不得再修改名單、抽獎與賽後紀錄。")) {
        return;
      }

      archiveBtn.disabled = true;

      api("POST", "/events/" + ck.eventId + "/archive", payload())
        .then(function () {
          toast("已封存。", "success");
          ck.listGroup = "archived";
          return loadEvents().then(renderSettle);
        })
        .catch(function (error) {
          toast(errorText(error), "error");
          archiveBtn.disabled = false;
        });
    });

    bar.appendChild(saveBtn);
    bar.appendChild(archiveBtn);
    bar.appendChild(el("span", "ck-bar-note", "封存後不得再修改"));

    main.appendChild(bar);
  }


  /* =======================================================
     報到
  ======================================================= */

  function renderCheckin() {

    var main = ck.main;

    clear(main);

    var head = viewHead("報到");
    var counter = el("span", "ck-head-count");

    head.appendChild(counter);
    main.appendChild(head);

    if (!ck.events.length || !currentEvent()) {
      main.appendChild(el("p", "empty", canUse("events")
        ? "還沒有場次。先到「場次管理」新增一個場次，再開始報到。"
        : "還沒有場次，請管理員先建立場次。"));
      return;
    }

    main.appendChild(eventSelect(renderCheckin));
    main.appendChild(segmented([["checkin", "報到"], ["list", "名單"]], ck.sub, function (sub) {
      ck.sub = sub;
      renderCheckin();
    }));

    var area = el("div", "ck-area");
    area.appendChild(el("p", "empty", "載入中…"));
    main.appendChild(area);

    loadEntries().then(function () {

      var checked = ck.entries.filter(function (e) { return Number(e.checked_in) === 1; }).length;

      counter.textContent = checked + " / " + ck.entries.length + " 已報到";

      clear(area);

      var locked = !!(currentEvent() && currentEvent().archived_at);

      if (locked) {
        area.appendChild(lockedBanner());
      }

      if (ck.sub === "list") {
        drawEntryList(area, locked);
      } else if (locked) {
        area.appendChild(el("p", "empty", "已封存的場次不能報到。可以切到「名單」查看。"));
      } else {
        drawBatch(area);
      }
    });
  }


  function loadEntries() {

    return api("GET", "/events/" + ck.eventId + "/entries")
      .then(function (response) {
        ck.entries = response.data || [];
      })
      .catch(function (error) {
        ck.entries = [];
        toast(errorText(error), "error");
      });
  }


  function findEntry(id) {
    for (var i = 0; i < ck.entries.length; i++) {
      if (ck.entries[i].id === id) {
        return ck.entries[i];
      }
    }
    return null;
  }


  function findPick(id) {
    for (var i = 0; i < ck.picked.length; i++) {
      if (ck.picked[i].id === id) {
        return ck.picked[i];
      }
    }
    return null;
  }


  /* 依點選順序算號碼：手動輸入用手動；已有號碼沿用；其餘從上一位 +1（起點 = 目前最大號） */
  function assignNumbers() {

    var assigned = {};
    var last = 0;

    ck.entries.forEach(function (entry) {
      last = Math.max(last, Number(entry.checkin_number) || 0);
    });

    ck.picked.forEach(function (pick) {

      var entry = findEntry(pick.id);

      if (!entry || !pick.check) {
        return;
      }

      var manual = pick.no !== null && pick.no !== "" && !isNaN(Number(pick.no));
      var n;

      if (manual) {
        n = Number(pick.no);
        last = n;
      } else if (entry.checkin_number) {
        n = Number(entry.checkin_number);
      } else {
        n = last + 1;
        last = n;
      }

      assigned[pick.id] = n;
    });

    return assigned;
  }


  function drawBatch(area) {

    var bar = el("div", "ck-search-bar");
    var search = input("search", ck.searched, { placeholder: "輸入關鍵字後按 Enter", autocomplete: "off", "aria-label": "搜尋參賽名稱" });

    search.className = "ck-search";

    var results = el("div", "ck-results");

    function doSearch() {
      ck.searched = search.value.trim();
      ck.picked = [];
      drawResults();
    }

    search.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        doSearch();
      }
    });

    var addBtn = button("＋", "btn btn-primary ck-add", function () {
      addEntry(search.value.trim(), null);
    });

    addBtn.setAttribute("aria-label", "新增報名");

    bar.appendChild(search);
    bar.appendChild(button("搜尋", "btn btn-gold", doSearch));
    bar.appendChild(addBtn);

    area.appendChild(bar);
    area.appendChild(results);

    function addEntry(name, playerId) {

      if (!name) {
        toast("請先輸入參賽名稱。", "error");
        search.focus();
        return;
      }

      api("POST", "/events/" + ck.eventId + "/entries", { nickname: name, player_id: playerId })
        .then(function (response) {
          ck.entries.push(response.data);
          toast("已新增報名：" + name, "success");
          ck.searched = name;
          search.value = name;
          ck.picked = [{ id: response.data.id, check: true, judge: false, no: null }];
          drawResults();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }

    function drawResults() {

      clear(results);

      var keyword = ck.searched.toLowerCase();

      if (!keyword) {
        results.appendChild(el("p", "field-help", "輸入名字或戰隊名的一部分（例如「黑鳳凰」），按 Enter 就會列出所有符合的人，可以一次報到多位。"));
        return;
      }

      var matched = ck.entries.filter(function (entry) {
        return entry.nickname.toLowerCase().indexOf(keyword) !== -1;
      });

      var info = el("div", "ck-result-info");

      info.appendChild(el("span", null, "「" + ck.searched + "」找到 " + matched.length + " 人"));
      info.appendChild(el("strong", null, "已選 " + ck.picked.length));
      results.appendChild(info);

      var assigned = assignNumbers();

      matched.forEach(function (entry) {
        results.appendChild(resultCard(entry, assigned));
      });

      /* 名單裡沒有的話，再從官網選手資料找 */
      var playerBox = el("div", "ck-player-box");
      results.appendChild(playerBox);

      api("GET", "/players?q=" + encodeURIComponent(ck.searched))
        .then(function (response) {

          var existing = {};

          ck.entries.forEach(function (entry) {
            existing[entry.nickname.toLowerCase()] = true;
          });

          (response.data || []).forEach(function (player) {

            var name = player.nickname || player.player_name;

            if (existing[name.toLowerCase()]) {
              return;
            }

            playerBox.appendChild(button("＋ 官網選手：" + name + (player.team_name ? "・" + player.team_name : ""), "ck-player-add", function () {
              addEntry(name, player.id);
            }));
          });
        })
        .catch(function () {
          /* 找不到選手資料不影響報到 */
        });

      if (!matched.length) {
        results.appendChild(el("p", "ck-empty-box", "找不到「" + ck.searched + "」。可以按「＋」直接新增這個名字，或從下方的官網選手加入。"));
        return;
      }

      var saveBtn = button(ck.picked.length ? "儲存（" + ck.picked.length + " 人）" : "先點選要處理的人", "btn btn-primary btn-block ck-big-btn", saveBatch);

      saveBtn.disabled = !ck.picked.length;
      results.appendChild(saveBtn);
      results.appendChild(el("p", "field-help ck-center",
        "號碼自動帶入：已有號碼的沿用，沒有的從目前最大號依序 +1，也可以手動改；改了之後，下一位會從你改的號碼接著 +1。再點一次名字就收起卡片，不列入這次報到。"));
    }

    function resultCard(entry, assigned) {

      var pick = findPick(entry.id);
      var open = !!pick;
      var card = el("div", "ck-result" + (open ? " open" : ""));
      var headBtn = button("", "ck-result-head");

      headBtn.setAttribute("aria-expanded", open ? "true" : "false");
      headBtn.appendChild(el("span", "ck-chevron", "›"));
      headBtn.appendChild(el("span", Number(entry.checked_in) === 1 ? "ck-status ck-status-left on" : "ck-status ck-status-left", Number(entry.checked_in) === 1 ? "已報到" : "未報到"));
      headBtn.appendChild(el("span", "ck-name", (entry.checkin_number ? entry.checkin_number + "- " : "") + entry.nickname));

      if (entry.user_id) {
        headBtn.appendChild(el("span", "ck-tag ck-tag-gold", "會員"));
      }

      if (entry.source === "online") {
        headBtn.appendChild(el("span", "ck-tag ck-tag-blue", "線上"));
      }

      if (entry.player_id) {
        headBtn.appendChild(el("span", "ck-tag ck-tag-gold", "選手"));
      }



      headBtn.addEventListener("click", function () {

        if (open) {
          ck.picked = ck.picked.filter(function (p) { return p.id !== entry.id; });
        } else {
          ck.picked.push({ id: entry.id, check: true, judge: Number(entry.is_judge) === 1, waived: Number(entry.fee_waived) === 1, no: null });
        }

        drawResults();
      });

      card.appendChild(headBtn);

      if (!open) {
        return card;
      }

      var body = el("div", "ck-result-body");
      var willCheck = pick.check;

      if (entry.source === "online" || entry.contact_phone) {
        body.appendChild(el("span", "ck-source",
          (entry.source === "online" ? "官網線上報名" : "現場新增") +
          (entry.contact_phone ? "・電話 " + entry.contact_phone : "")));
      }

      var checkBtn = button("", "ck-check" + (willCheck ? " on" : ""), function () {
        pick.check = !pick.check;
        pick.no = null;

        if (!pick.check) {
          pick.judge = false;
          pick.waived = false;
        }

        drawResults();
      });

      checkBtn.setAttribute("role", "checkbox");
      checkBtn.setAttribute("aria-checked", willCheck ? "true" : "false");
      checkBtn.appendChild(el("span", "ck-box", willCheck ? "✓" : ""));
      checkBtn.appendChild(el("span", null, willCheck
        ? "已報到"
        : (Number(entry.checked_in) === 1 ? "取消報到（儲存後清除號碼）" : "未報到")));

      body.appendChild(checkBtn);

      if (willCheck) {

        var row = el("div", "ck-row ck-check-row");
        var numberInput = input("number", assigned[entry.id] || "", { min: "1", inputmode: "numeric", "aria-label": "參賽號碼" });

        numberInput.className = "ck-number";

        numberInput.addEventListener("change", function () {
          pick.no = numberInput.value;
          drawResults();
        });

        var judgeBtn = button("裁判 ㊣", "ck-judge" + (pick.judge ? " on" : ""), function () {
          pick.judge = !pick.judge;
          drawResults();
        });

        judgeBtn.setAttribute("role", "switch");
        judgeBtn.setAttribute("aria-checked", pick.judge ? "true" : "false");

        /* 免：免報名費（前台不顯示，賽後紀錄另外計算） */
        var waiveBtn = button("免", "ck-judge ck-waive" + (pick.waived ? " on" : ""), function () {
          pick.waived = !pick.waived;
          drawResults();
        });

        waiveBtn.setAttribute("role", "switch");
        waiveBtn.setAttribute("aria-checked", pick.waived ? "true" : "false");
        waiveBtn.setAttribute("aria-label", "免報名費");

        row.appendChild(field("參賽號碼", numberInput));
        row.appendChild(judgeBtn);
        row.appendChild(waiveBtn);
        body.appendChild(row);
      }

      body.appendChild(button("刪除這筆報名", "ck-link-danger", function () {

        if (!confirmBox("確定要刪除「" + entry.nickname + "」的報名？")) {
          return;
        }

        api("DELETE", "/entries/" + entry.id)
          .then(function () {
            toast("已刪除報名。", "success");
            ck.entries = ck.entries.filter(function (e) { return e.id !== entry.id; });
            ck.picked = ck.picked.filter(function (p) { return p.id !== entry.id; });
            drawResults();
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));

      card.appendChild(body);

      return card;
    }

    function saveBatch() {

      if (!ck.picked.length) {
        return;
      }

      var assigned = assignNumbers();

      var items = ck.picked.map(function (pick) {
        return {
          id: pick.id,
          checked_in: pick.check ? 1 : 0,
          checkin_number: pick.check ? assigned[pick.id] : null,
          is_judge: pick.check && pick.judge ? 1 : 0,
          fee_waived: pick.check && pick.waived ? 1 : 0
        };
      });

      var summary = ck.picked.map(function (pick) {
        var entry = findEntry(pick.id);
        return pick.check
          ? assigned[pick.id] + "- " + entry.nickname + (pick.judge ? " ㊣" : "")
          : "取消 " + entry.nickname;
      });

      api("PUT", "/events/" + ck.eventId + "/entries/batch", { items: items })
        .then(function (response) {
          ck.entries = response.data || [];
          ck.picked = [];
          toast("已儲存：" + summary.join("、"), "success");
          renderCheckin();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }

    drawResults();

    if (!ck.searched) {
      setTimeout(function () { search.focus(); }, 50);
    }
  }


  function drawEntryList(area, locked) {

    var tools = el("div", "ck-actions");

    tools.appendChild(button("📋 複製名單（打散）", "btn btn-primary", copyList));

    if (!locked) {
      tools.appendChild(button("📥 匯入名單", "btn btn-ghost", openImport));
    }

    area.appendChild(tools);
    area.appendChild(el("p", "field-help", "複製時會把同戰隊（名稱前三個字相同）的人錯開，方便貼到群組排對戰。"));

    if (!ck.entries.length) {
      area.appendChild(el("p", "empty", "這個場次還沒有人報名。"));
      return;
    }

    var list = el("div", "ck-list");

    ck.entries.forEach(function (entry) {

      var checked = Number(entry.checked_in) === 1;
      var row = button("", "ck-entry-row" + (checked ? " on" : ""), function () {

        if (locked) {
          return;
        }

        ck.sub = "checkin";
        ck.searched = entry.nickname;
        ck.picked = [{ id: entry.id, check: true, judge: Number(entry.is_judge) === 1, waived: Number(entry.fee_waived) === 1, no: null }];
        renderCheckin();
      });

      row.appendChild(el("span", "ck-num" + (checked ? " on" : ""), checked && entry.checkin_number ? String(entry.checkin_number) : "—"));
      row.appendChild(el("span", "ck-name", entry.nickname + (Number(entry.is_judge) === 1 ? " ㊣" : "")));

      if (Number(entry.fee_waived) === 1) {
        row.appendChild(el("span", "ck-tag ck-tag-blue", "免"));
      }

      if (Number(entry.has_won) === 1) {
        row.appendChild(el("span", "ck-tag ck-tag-gold", "中獎"));
      }

      row.appendChild(el("span", checked ? "ck-status on" : "ck-status", checked ? "已報到" : "未報到"));

      list.appendChild(row);
    });

    area.appendChild(list);
  }


  /* 依名稱前三個字分組（通常是戰隊名），盡量讓同組不相鄰 */
  function buildCopyText() {

    var checked = ck.entries.filter(function (e) { return Number(e.checked_in) === 1; });
    var groups = {};

    checked.forEach(function (entry) {

      var prefix = Array.from(String(entry.nickname || "")).slice(0, 3).join("");

      if (!groups[prefix]) {
        groups[prefix] = [];
      }

      groups[prefix].push(entry);
    });

    var keys = Object.keys(groups);

    keys.forEach(function (key) {
      groups[key].sort(function (a, b) {
        return (a.checkin_number || 999999) - (b.checkin_number || 999999);
      });
    });

    var result = [];
    var last = null;

    while (result.length < checked.length) {

      var available = keys.filter(function (key) { return groups[key].length > 0; });

      if (!available.length) {
        break;
      }

      var candidates = available.filter(function (key) { return key !== last; });

      if (!candidates.length) {
        candidates = available;
      }

      candidates.sort(function (a, b) {
        return groups[b].length - groups[a].length;
      });

      last = candidates[0];
      result.push(groups[last].shift());
    }

    return result.map(function (entry) {
      return (entry.checkin_number ? entry.checkin_number + "- " : "") + entry.nickname + (Number(entry.is_judge) === 1 ? " ㊣" : "");
    }).join("\n");
  }


  function copyList() {

    var text = buildCopyText();

    if (!text) {
      toast("目前沒有已報到的選手。", "error");
      return;
    }

    function fallback() {

      var node = el("textarea");
      node.value = text;
      node.style.position = "fixed";
      node.style.left = "-9999px";

      document.body.appendChild(node);
      node.select();

      var ok = false;

      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }

      document.body.removeChild(node);

      toast(ok ? "已打散並複製名單。" : "複製失敗，請手動複製。", ok ? "success" : "error");
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(function () {
          toast("已打散並複製名單。", "success");
        })
        .catch(fallback);
    } else {
      fallback();
    }
  }


  function openImport() {

    var bodyNode = el("div", "panel-body");
    var teamInput = input("text", "", { maxlength: "20", placeholder: "例如：黑鳳凰" });
    var textArea = textarea("", { rows: "10", placeholder: "每行一位參賽者，空白行會自動跳過\n例如：\n小明\n小華" });

    bodyNode.appendChild(field("戰隊名（選填，會加在每個名字前面）", teamInput));
    bodyNode.appendChild(field("參賽名單", textArea, "同場次已經有的名字會自動略過。"));

    var importBtn = button("開始匯入", "btn btn-primary", function () {

      if (!textArea.value.trim()) {
        toast("請先貼上參賽名單。", "error");
        textArea.focus();
        return;
      }

      importBtn.disabled = true;

      api("POST", "/events/" + ck.eventId + "/import", { team_prefix: teamInput.value, text: textArea.value })
        .then(function (response) {

          closeModal();

          var message = "成功匯入 " + response.imported + " 人";

          if (response.duplicates) {
            message += "，重複略過 " + response.duplicates + " 人";
          }

          if (response.invalid && response.invalid.length) {
            message += "，格式不符略過 " + response.invalid.length + " 行";
          }

          toast(message, "success");
          renderCheckin();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          importBtn.disabled = false;
        });
    });

    openModal("📥 匯入參賽名單", bodyNode, [
      el("span", "panel-foot-space"),
      button("取消", "btn btn-ghost", closeModal),
      importBtn
    ]);
  }


  /* =======================================================
     抽獎：扭蛋機
  ======================================================= */

  var lot = {
    data: null,
    tierId: null,
    wrap: null,
    title: null,
    stats: null,
    tierBox: null,
    stage: null,
    machine: null,
    capsule: null,
    result: null,
    winners: null,
    drawBtn: null,
    fullBtn: null,
    prizeInput: null,
    excluded: [],
    lastFlags: {}
  };


  function renderLottery() {

    var main = ck.main;

    clear(main);
    main.appendChild(viewHead("抽獎"));

    main.appendChild(segmented([["event", "綁定場次"], ["free", "自由抽獎"]], lot.mode || "event", function (mode) {
      if (ck.drawing) {
        return;
      }
      lot.mode = mode;
      renderLottery();
    }));

    if (lot.mode === "free") {
      renderFreeLottery();
      return;
    }

    if (!ck.events.length || !currentEvent()) {
      main.appendChild(el("p", "empty", "還沒有場次。可以切到「自由抽獎」，自己輸入名單和獎項。"));
      return;
    }

    main.appendChild(eventSelect(function () {
      lot.tierId = null;
      lot.excluded = [];
      renderLottery();
    }));

    /* 全螢幕時整塊（獎項、扭蛋機、抽獎按鈕、中獎紀錄）一起放大 */
    lot.wrap = el("div", "ck-lot");

    var top = el("div", "ck-lot-top");
    lot.title = el("strong", "ck-lot-title", currentEvent().title);

    lot.fullBtn = button("⛶ 全螢幕", "btn btn-ghost btn-small", toggleFullscreen);

    top.appendChild(lot.title);
    top.appendChild(lot.fullBtn);

    lot.stats = el("div", "ck-stats ck-lot-stats");
    lot.tierBox = el("div", "ck-tiers ck-lot-tiers");
    lot.stage = el("div", "ck-lot-stage");

    var machine = el("div", "gacha");
    var dome = el("div", "gacha-dome");

    var BALLS = [
      [4, 74], [22, 74], [40, 74], [58, 74], [76, 74],
      [13, 57], [31, 57], [49, 57], [67, 57],
      [22, 40], [40, 40], [58, 40],
      [31, 23], [49, 23]
    ];

    BALLS.forEach(function (pos, i) {

      var ball = el("span", "gacha-ball");

      ball.style.setProperty("--c", CAPSULE_COLORS[i % CAPSULE_COLORS.length]);
      ball.style.left = pos[0] + "%";
      ball.style.top = pos[1] + "%";
      ball.style.setProperty("--d", (i % 5) * 0.07 + "s");

      dome.appendChild(ball);
    });

    var bodyNode = el("div", "gacha-body");
    var knob = el("div", "gacha-knob");
    knob.appendChild(el("span", "gacha-knob-bar"));

    var slot = el("div", "gacha-slot");

    lot.capsule = el("div", "gacha-capsule");
    lot.capsule.appendChild(el("span", "gacha-capsule-top"));
    lot.capsule.appendChild(el("span", "gacha-capsule-bottom"));
    slot.appendChild(lot.capsule);

    bodyNode.appendChild(knob);
    bodyNode.appendChild(slot);

    var sign = el("div", "gacha-sign");
    var logo = el("img");

    logo.src = "/images/ourspace-logo.jpg";
    logo.alt = "";
    sign.appendChild(logo);
    sign.appendChild(el("span", null, "窩室"));

    machine.appendChild(sign);
    machine.appendChild(dome);
    machine.appendChild(bodyNode);

    lot.machine = machine;
    lot.stage.appendChild(machine);

    lot.result = el("div", "gacha-result");
    lot.result.hidden = true;
    lot.stage.appendChild(lot.result);

    var controls = el("div", "ck-lot-controls");

    lot.prizeInput = input("text", "", { maxlength: "100", placeholder: "獎品（選填）", "aria-label": "獎品" });
    lot.prizeInput.className = "ck-search";

    lot.drawBtn = button("🎲 轉動扭蛋", "btn btn-primary ck-big-btn ck-draw", startDraw);

    controls.appendChild(lot.prizeInput);
    controls.appendChild(lot.drawBtn);

    lot.winners = el("div", "ck-winners");

    lot.wrap.appendChild(top);
    lot.wrap.appendChild(lot.stats);
    lot.wrap.appendChild(lot.tierBox);
    lot.wrap.appendChild(lot.stage);
    lot.wrap.appendChild(controls);
    lot.wrap.appendChild(lot.winners);

    main.appendChild(lot.wrap);

    document.removeEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("fullscreenchange", onFullscreen);

    loadLottery();
  }


  function toggleFullscreen() {

    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }

    if (lot.wrap.requestFullscreen) {
      lot.wrap.requestFullscreen().catch(function () {
        /* 不支援全螢幕的瀏覽器（例如 iPhone）：改用撐滿畫面的方式 */
        lot.wrap.classList.toggle("is-full");
        onFullscreen();
      });
    } else {
      lot.wrap.classList.toggle("is-full");
      onFullscreen();
    }
  }


  function onFullscreen() {

    if (!lot.wrap) {
      return;
    }

    var full = document.fullscreenElement === lot.wrap || lot.wrap.classList.contains("is-full");

    lot.fullBtn.textContent = full ? "✕ 離開全螢幕" : "⛶ 全螢幕";
    document.body.classList.toggle("lot-full", full);
  }


  function loadLottery() {

    return api("GET", "/events/" + ck.eventId + "/lottery")
      .then(function (response) {
        lot.data = response.data;
        drawLotteryInfo();
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  function currentTier() {

    var tiers = (lot.data && lot.data.tiers) || [];

    for (var i = 0; i < tiers.length; i++) {
      if (tiers[i].id === lot.tierId) {
        return tiers[i];
      }
    }

    return null;
  }


  function drawLotteryInfo() {

    var data = lot.data;

    if (!data) {
      return;
    }

    clear(lot.stats);
    lot.stats.appendChild(stat("已報到", data.checked_count + " 人", true));
    lot.stats.appendChild(stat("可抽人數", data.eligible_count + " 人"));
    lot.stats.appendChild(stat("已抽出", data.wins.length + " 人"));

    /* 預設選第一個還沒抽滿的門檻 */
    if (!currentTier() && data.tiers.length) {

      lot.tierId = data.tiers[0].id;

      for (var i = 0; i < data.tiers.length; i++) {
        if (data.tiers[i].drawn < data.tiers[i].qty) {
          lot.tierId = data.tiers[i].id;
          break;
        }
      }
    }

    clear(lot.tierBox);

    if (data.tiers.length) {

      lot.tierBox.appendChild(el("span", "field-label", "選擇要抽的獎"));

      data.tiers.forEach(function (tier) {

        var below = tier.min_players > 0 && data.checked_count < tier.min_players;
        var full = tier.drawn >= tier.qty;
        var node = button("", "ck-tier" + (tier.id === lot.tierId ? " active" : "") + (below ? " below" : "") + (full ? " full" : ""), function () {
          if (ck.drawing) {
            return;
          }
          lot.tierId = tier.id;
          lot.excluded = [];
          drawLotteryInfo();
        });

        node.setAttribute("aria-pressed", tier.id === lot.tierId ? "true" : "false");
        node.appendChild(el("strong", null, (tier.prize || "抽獎") + " × " + tier.qty));
        node.appendChild(el("span", null,
          (tier.min_players > 0 ? "報到滿 " + tier.min_players + " 人" : "不限人數") +
          "・已抽 " + tier.drawn + (below ? "・人數未達" : "") + (full ? "・已抽滿" : "")));

        var line = el("div", "ck-tier-line");

        line.appendChild(node);

        if (!data.archived) {
          line.appendChild(removeButton("刪除這個獎項", function () {

            if (!confirmBox("刪除獎項「" + (tier.prize || "抽獎") + "」？已經抽出的中獎紀錄會保留。")) {
              return;
            }

            api("DELETE", "/tiers/" + tier.id)
              .then(function (response) {
                lot.data = response.data;
                lot.tierId = null;
                drawLotteryInfo();
              })
              .catch(function (error) {
                toast(errorText(error), "error");
              });
          }));
        }

        lot.tierBox.appendChild(line);
      });
    }

    /* 直接在抽獎頁新增獎項 */
    if (!data.archived) {

      var addBox = el("details", "ck-tier-add");
      var prizeName = input("text", "", { maxlength: "100", placeholder: "獎品名稱", "aria-label": "獎品名稱" });
      var qty = input("number", "1", { min: "1", inputmode: "numeric", "aria-label": "名額" });
      var min = input("number", "", { min: "0", inputmode: "numeric", placeholder: "不限", "aria-label": "報到滿幾人才能抽（選填）" });
      var addRow = el("div", "ck-inline");

      qty.className = "ck-w-num";
      min.className = "ck-w-num";

      addBox.appendChild(el("summary", null, "＋ 新增獎項"));
      addBox.appendChild(prizeName);

      addRow.appendChild(el("span", "ck-inline-label", "名額"));
      addRow.appendChild(qty);
      addRow.appendChild(el("span", "ck-inline-label", "門檻"));
      addRow.appendChild(min);
      addRow.appendChild(el("span", "ck-inline-label", "人"));
      addBox.appendChild(addRow);

      addBox.appendChild(button("加入獎項", "btn btn-gold btn-block", function () {

        if (!prizeName.value.trim()) {
          toast("請輸入獎品名稱。", "error");
          return;
        }

        api("POST", "/events/" + ck.eventId + "/tiers", { prize: prizeName.value, qty: qty.value || 1, min_players: min.value || 0 })
          .then(function (response) {
            lot.data = response.data;
            lot.tierId = data.tiers.length ? lot.tierId : null;
            toast("已新增獎項。", "success");
            drawLotteryInfo();
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));

      lot.tierBox.appendChild(addBox);
    }

    lot.prizeInput.hidden = !!data.tiers.length;

    var locked = data.archived;

    lot.drawBtn.disabled = locked || ck.drawing;

    clear(lot.winners);

    if (locked) {
      lot.winners.appendChild(lockedBanner());
    }

    var title = el("div", "ck-section-title");
    title.appendChild(el("h2", null, "中獎紀錄（" + data.wins.length + "）"));
    lot.winners.appendChild(title);

    if (!data.wins.length) {
      lot.winners.appendChild(el("p", "field-help", "還沒有人中獎。"));
      return;
    }

    data.wins.forEach(function (win) {

      var row = el("div", "ck-entry-row on");

      row.appendChild(el("span", "ck-num on", win.checkin_number ? String(win.checkin_number) : "—"));

      var info = el("span", "ck-name");
      info.appendChild(el("strong", null, win.nickname + (Number(win.is_judge) === 1 ? " ㊣" : "")));
      info.appendChild(el("small", null, win.prize || "（未填獎品）"));
      row.appendChild(info);

      if (!locked) {
        row.appendChild(button("撤銷", "btn btn-ghost btn-small", function () {

          if (!confirmBox("撤銷「" + win.nickname + "」的中獎？撤銷後這位選手可以再被抽到。")) {
            return;
          }

          api("DELETE", "/lottery/" + win.id)
            .then(function () {
              toast("已撤銷。", "success");
              loadLottery();
            })
            .catch(function (error) {
              toast(errorText(error), "error");
            });
        }));
      }

      lot.winners.appendChild(row);
    });
  }


  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }


  function startDraw() {

    if (ck.drawing || !lot.data) {
      return;
    }

    var data = lot.data;
    var tier = currentTier();
    var flags = {};

    if (tier && tier.min_players > 0 && data.checked_count < tier.min_players) {

      if (!confirmBox("報到人數 " + data.checked_count + " 人，未達這個獎的門檻 " + tier.min_players + " 人。\n確定仍要抽獎嗎？")) {
        return;
      }

      flags.confirm_below_threshold = true;
    }

    if (tier && tier.drawn >= tier.qty) {

      if (!confirmBox("「" + (tier.prize || "抽獎") + "」已經抽滿 " + tier.qty + " 位了。\n確定要再多抽一位嗎？")) {
        return;
      }

      flags.confirm_over_quota = true;
    }

    if (!data.eligible_count) {
      toast(ERRORS.NO_ELIGIBLE, "error");
      return;
    }

    lot.excluded = [];
    runDraw(flags);
  }


  function runDraw(flags) {

    ck.drawing = true;
    lot.drawBtn.disabled = true;
    lot.result.hidden = true;
    lot.lastFlags = flags;

    var color = CAPSULE_COLORS[Math.floor(Math.random() * CAPSULE_COLORS.length)];
    var tier = currentTier();

    lot.capsule.style.setProperty("--c", color);
    lot.machine.classList.remove("is-dropping", "is-open");
    void lot.machine.offsetWidth;
    lot.machine.classList.add("is-spinning");

    var body = {
      tier_id: tier ? tier.id : null,
      prize: tier ? null : lot.prizeInput.value,
      confirm_below_threshold: !!flags.confirm_below_threshold,
      confirm_over_quota: true,
      exclude_entry_ids: lot.excluded
    };

    /* 第一次抽才檢查名額；重抽是取代剛剛那位 */
    if (!lot.excluded.length) {
      body.confirm_over_quota = !!flags.confirm_over_quota;
    }

    function finish() {
      ck.drawing = false;
      lot.drawBtn.disabled = !!(lot.data && lot.data.archived);
    }

    Promise.all([api("POST", "/events/" + ck.eventId + "/lottery", body), wait(1800)])
      .then(function (results) {

        var response = results[0];

        lot.machine.classList.remove("is-spinning");
        lot.machine.classList.add("is-dropping");

        return wait(900).then(function () {

          lot.machine.classList.add("is-open");

          return wait(350).then(function () {
            lot.data = response.data;
            drawLotteryInfo();
            showWinner(response.winner, color);
            finish();
          });
        });
      })
      .catch(function (error) {

        lot.machine.classList.remove("is-spinning", "is-dropping", "is-open");

        if (error.data) {
          lot.data = error.data;
          drawLotteryInfo();
        }

        finish();
        toast(errorText(error), "error");
      });
  }


  /* 抽出後：確認，或重抽（剛剛那位這一輪不會再被抽到） */
  function showWinner(winner, color) {

    clear(lot.result);

    if (!winner) {
      return;
    }

    var card = el("div", "gacha-result-card");
    card.style.setProperty("--c", color);

    card.appendChild(el("div", "gacha-result-kicker", "🎉 恭喜中獎"));

    if (winner.checkin_number) {
      card.appendChild(el("div", "gacha-result-number", "No." + winner.checkin_number));
    }

    card.appendChild(el("div", "gacha-result-name", winner.nickname));

    if (winner.prize) {
      card.appendChild(el("div", "gacha-result-prize", winner.prize));
    }

    var actions = el("div", "gacha-result-actions");

    var redo = button("↻ 重抽", "btn btn-ghost gacha-redo", function () {

      redo.disabled = true;
      ok.disabled = true;

      api("DELETE", "/lottery/" + winner.id)
        .then(function () {
          lot.excluded.push(winner.entry_id);
          runDraw(lot.lastFlags || {});
        })
        .catch(function (error) {
          redo.disabled = false;
          ok.disabled = false;
          toast(errorText(error), "error");
        });
    });

    var ok = button("✓ 確認", "btn btn-primary", function () {
      lot.result.hidden = true;
      lot.excluded = [];
      toast("已確認：" + winner.nickname + (winner.prize ? "・" + winner.prize : ""), "success");
    });

    actions.appendChild(redo);
    actions.appendChild(ok);
    card.appendChild(actions);

    card.appendChild(el("div", "gacha-result-hint", "人不在現場可以按「重抽」，剛剛那位這一輪不會再被抽到。"));

    lot.result.appendChild(card);
    lot.result.hidden = false;
  }


  /* =======================================================
     自由抽獎（不綁場次；名單與獎項自己加，關掉頁面就清空）
  ======================================================= */

  var free = {
    names: [],
    prizes: [],
    prizeIdx: 0,
    winners: [],
    excluded: [],
    ui: null
  };


  function makeGachaStage() {

    var stage = el("div", "ck-lot-stage");
    var machine = el("div", "gacha");
    var dome = el("div", "gacha-dome");

    [
      [4, 74], [22, 74], [40, 74], [58, 74], [76, 74],
      [13, 57], [31, 57], [49, 57], [67, 57],
      [22, 40], [40, 40], [58, 40],
      [31, 23], [49, 23]
    ].forEach(function (pos, i) {
      var ball = el("span", "gacha-ball");
      ball.style.setProperty("--c", CAPSULE_COLORS[i % CAPSULE_COLORS.length]);
      ball.style.left = pos[0] + "%";
      ball.style.top = pos[1] + "%";
      ball.style.setProperty("--d", (i % 5) * 0.07 + "s");
      dome.appendChild(ball);
    });

    var bodyNode = el("div", "gacha-body");
    var knob = el("div", "gacha-knob");
    knob.appendChild(el("span", "gacha-knob-bar"));

    var slot = el("div", "gacha-slot");
    var capsule = el("div", "gacha-capsule");

    capsule.appendChild(el("span", "gacha-capsule-top"));
    capsule.appendChild(el("span", "gacha-capsule-bottom"));
    slot.appendChild(capsule);

    bodyNode.appendChild(knob);
    bodyNode.appendChild(slot);

    var sign = el("div", "gacha-sign");
    var logo = el("img");

    logo.src = "/images/ourspace-logo.jpg";
    logo.alt = "";
    sign.appendChild(logo);
    sign.appendChild(el("span", null, "窩室"));

    machine.appendChild(sign);
    machine.appendChild(dome);
    machine.appendChild(bodyNode);
    stage.appendChild(machine);

    var result = el("div", "gacha-result");
    result.hidden = true;
    stage.appendChild(result);

    return { stage: stage, machine: machine, capsule: capsule, result: result };
  }


  function randomIndex(length) {
    var bytes = new Uint32Array(1);
    window.crypto.getRandomValues(bytes);
    return bytes[0] % length;
  }


  function renderFreeLottery() {

    var main = ck.main;
    var ui = {};

    free.ui = ui;

    ui.wrap = el("div", "ck-lot");

    var top = el("div", "ck-lot-top");
    top.appendChild(el("strong", "ck-lot-title", "自由抽獎"));

    ui.fullBtn = button("⛶ 全螢幕", "btn btn-ghost btn-small", function () {
      lot.wrap = ui.wrap;
      lot.fullBtn = ui.fullBtn;
      toggleFullscreen();
    });

    top.appendChild(ui.fullBtn);

    ui.stats = el("div", "ck-stats ck-lot-stats");
    ui.side = el("div", "ck-tiers ck-lot-tiers");

    var gacha = makeGachaStage();

    ui.stage = gacha.stage;
    ui.machine = gacha.machine;
    ui.capsule = gacha.capsule;
    ui.result = gacha.result;

    var controls = el("div", "ck-lot-controls");

    ui.drawBtn = button("🎲 轉動扭蛋", "btn btn-primary ck-big-btn ck-draw", freeDraw);
    controls.appendChild(ui.drawBtn);

    ui.winners = el("div", "ck-winners");

    ui.wrap.appendChild(top);
    ui.wrap.appendChild(ui.stats);
    ui.wrap.appendChild(ui.side);
    ui.wrap.appendChild(ui.stage);
    ui.wrap.appendChild(controls);
    ui.wrap.appendChild(ui.winners);

    /* 名單與獎項設定（在扭蛋機上方，全螢幕時不顯示） */
    var setup = el("div", "ck-free-setup");

    var namesArea = textarea(free.names.join("\n"), { rows: "6", placeholder: "每行一個名字", "aria-label": "抽獎名單" });

    namesArea.addEventListener("change", function () {
      var seen = {};
      free.names = namesArea.value.split(/\n/).map(function (n) { return n.trim(); }).filter(function (n) {
        if (!n || seen[n]) {
          return false;
        }
        seen[n] = true;
        return true;
      });
      namesArea.value = free.names.join("\n");
      drawFree();
    });

    setup.appendChild(field("抽獎名單（每行一個名字）", namesArea));

    if (ck.events.length) {

      var importRow = el("div", "ck-inline");
      var eventPick = el("select", "ck-select ck-grow");

      eventPick.setAttribute("aria-label", "從場次帶入");

      ck.events.slice().reverse().forEach(function (event) {
        var option = el("option", null, dateLabel(event.event_date) + "　" + event.title);
        option.value = String(event.id);
        option.selected = event.id === ck.eventId;
        eventPick.appendChild(option);
      });

      importRow.appendChild(eventPick);
      importRow.appendChild(button("帶入已報到名單", "btn btn-ghost", function () {
        api("GET", "/events/" + eventPick.value + "/entries")
          .then(function (response) {

            var added = 0;

            (response.data || []).forEach(function (entry) {
              if (Number(entry.checked_in) === 1 && free.names.indexOf(entry.nickname) === -1) {
                free.names.push(entry.nickname);
                added++;
              }
            });

            namesArea.value = free.names.join("\n");
            toast("帶入 " + added + " 人。", "success");
            drawFree();
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));

      setup.appendChild(importRow);
    }

    var prizeRow = el("div", "ck-inline");
    var prizeName = input("text", "", { maxlength: "100", placeholder: "獎品名稱", "aria-label": "獎品名稱" });
    var prizeQty = input("number", "1", { min: "1", inputmode: "numeric", "aria-label": "名額" });

    prizeQty.className = "ck-w-num";

    prizeRow.appendChild(prizeName);
    prizeRow.appendChild(el("span", "ck-inline-label", "×"));
    prizeRow.appendChild(prizeQty);
    prizeRow.appendChild(button("＋ 獎項", "btn btn-gold", function () {

      if (!prizeName.value.trim()) {
        toast("請輸入獎品名稱。", "error");
        return;
      }

      free.prizes.push({ name: prizeName.value.trim(), qty: Math.max(1, Number(prizeQty.value) || 1) });
      prizeName.value = "";
      prizeQty.value = "1";
      drawFree();
    }));

    setup.appendChild(field("獎項（選填，不加也可以直接抽）", prizeRow));

    setup.appendChild(button("全部清空（名單、獎項、中獎紀錄）", "ck-link-danger", function () {

      if (!confirmBox("確定要清空自由抽獎的所有資料？")) {
        return;
      }

      free.names = [];
      free.prizes = [];
      free.winners = [];
      free.excluded = [];
      free.prizeIdx = 0;
      renderLottery();
    }));

    main.appendChild(setup);
    main.appendChild(ui.wrap);

    document.removeEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("fullscreenchange", onFullscreen);

    drawFree();
  }


  function freePool() {
    var won = free.winners.map(function (w) { return w.name; });
    return free.names.filter(function (n) {
      return won.indexOf(n) === -1 && free.excluded.indexOf(n) === -1;
    });
  }


  function drawFree() {

    var ui = free.ui;

    if (!ui) {
      return;
    }

    clear(ui.stats);
    ui.stats.appendChild(stat("名單", free.names.length + " 人", true));
    ui.stats.appendChild(stat("可抽人數", freePool().length + " 人"));
    ui.stats.appendChild(stat("已抽出", free.winners.length + " 人"));

    clear(ui.side);

    if (free.prizes.length) {

      ui.side.appendChild(el("span", "field-label", "選擇要抽的獎"));

      free.prizes.forEach(function (prize, index) {

        var drawn = free.winners.filter(function (w) { return w.prizeIndex === index; }).length;
        var line = el("div", "ck-tier-line");
        var node = button("", "ck-tier" + (index === free.prizeIdx ? " active" : "") + (drawn >= prize.qty ? " full" : ""), function () {
          if (!ck.drawing) {
            free.prizeIdx = index;
            free.excluded = [];
            drawFree();
          }
        });

        node.appendChild(el("strong", null, prize.name + " × " + prize.qty));
        node.appendChild(el("span", null, "已抽 " + drawn + (drawn >= prize.qty ? "・已抽滿" : "")));

        line.appendChild(node);
        line.appendChild(removeButton("刪除這個獎項", function () {
          free.prizes.splice(index, 1);
          free.prizeIdx = 0;
          drawFree();
        }));

        ui.side.appendChild(line);
      });
    }

    ui.drawBtn.disabled = ck.drawing;

    clear(ui.winners);

    var title = el("div", "ck-section-title");
    title.appendChild(el("h2", null, "中獎紀錄（" + free.winners.length + "）"));
    ui.winners.appendChild(title);

    if (!free.winners.length) {
      ui.winners.appendChild(el("p", "field-help", "還沒有人中獎。"));
    }

    free.winners.slice().reverse().forEach(function (w) {

      var row = el("div", "ck-entry-row on");
      var info = el("span", "ck-name");

      info.appendChild(el("strong", null, w.name));
      info.appendChild(el("small", null, w.prize || "（沒有指定獎品）"));
      row.appendChild(info);

      row.appendChild(button("撤銷", "btn btn-ghost btn-small", function () {
        free.winners.splice(free.winners.indexOf(w), 1);
        drawFree();
      }));

      ui.winners.appendChild(row);
    });
  }


  function freeDraw() {

    if (ck.drawing) {
      return;
    }

    var prize = free.prizes[free.prizeIdx] || null;

    if (prize) {

      var drawn = free.winners.filter(function (w) { return w.prizeIndex === free.prizeIdx; }).length;

      if (drawn >= prize.qty && !confirmBox("「" + prize.name + "」已經抽滿 " + prize.qty + " 位了。\n確定要再多抽一位嗎？")) {
        return;
      }
    }

    free.excluded = [];
    freeRun();
  }


  function freeRun() {

    var ui = free.ui;
    var pool = freePool();

    if (!pool.length) {
      toast(free.names.length ? "已經沒有可以抽的人了。" : "請先輸入抽獎名單。", "error");
      return;
    }

    var prize = free.prizes[free.prizeIdx] || null;
    var name = pool[randomIndex(pool.length)];
    var color = CAPSULE_COLORS[randomIndex(CAPSULE_COLORS.length)];
    var winner = { name: name, prize: prize ? prize.name : "", prizeIndex: prize ? free.prizeIdx : -1 };

    ck.drawing = true;
    ui.drawBtn.disabled = true;
    ui.result.hidden = true;

    ui.capsule.style.setProperty("--c", color);
    ui.machine.classList.remove("is-dropping", "is-open");
    void ui.machine.offsetWidth;
    ui.machine.classList.add("is-spinning");

    wait(1800)
      .then(function () {
        ui.machine.classList.remove("is-spinning");
        ui.machine.classList.add("is-dropping");
        return wait(900);
      })
      .then(function () {
        ui.machine.classList.add("is-open");
        return wait(350);
      })
      .then(function () {

        free.winners.push(winner);
        ck.drawing = false;
        drawFree();

        clear(ui.result);

        var card = el("div", "gacha-result-card");
        card.style.setProperty("--c", color);
        card.appendChild(el("div", "gacha-result-kicker", "🎉 恭喜中獎"));
        card.appendChild(el("div", "gacha-result-name", winner.name));

        if (winner.prize) {
          card.appendChild(el("div", "gacha-result-prize", winner.prize));
        }

        var actions = el("div", "gacha-result-actions");

        actions.appendChild(button("↻ 重抽", "btn btn-ghost gacha-redo", function () {
          free.winners.splice(free.winners.indexOf(winner), 1);
          free.excluded.push(winner.name);
          freeRun();
        }));

        actions.appendChild(button("✓ 確認", "btn btn-primary", function () {
          ui.result.hidden = true;
          free.excluded = [];
          toast("已確認：" + winner.name + (winner.prize ? "・" + winner.prize : ""), "success");
        }));

        card.appendChild(actions);
        card.appendChild(el("div", "gacha-result-hint", "人不在現場可以按「重抽」，剛剛那位這一輪不會再被抽到。"));

        ui.result.appendChild(card);
        ui.result.hidden = false;
      });
  }


  /* =======================================================
     網站設定
  ======================================================= */

  function renderSite() {

    api("GET", "/site")
      .then(function (response) {
        drawSite(response.data);
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  function drawSite(data) {

    var main = ck.main;

    var form = {
      hours: (data.store.hours || []).map(function (h) { return { day: h.day, time: h.time }; }),
      about_image_id: data.about.image_id,
      about_image_url: data.about.image_url,
      presets: {},
      presetTab: "bonus"
    };

    PRESET_FIELDS.forEach(function (def) {
      form.presets[def.key] = ((data.presets && data.presets[def.key]) || []).slice();
    });

    clear(main);
    main.appendChild(viewHead("網站設定"));
    main.appendChild(el("p", "view-hint", "這裡改的內容會直接顯示在官網，不用改程式。"));

    var wrap = el("div", "ck-form");

    /* ---------- 來店資訊 ---------- */

    var store = el("div", "ck-block");
    var hourList = el("div", "ck-list");

    function drawHours() {

      clear(hourList);

      form.hours.forEach(function (row, index) {

        var line = el("div", "ck-inline");
        var day = input("text", row.day, { maxlength: "30", placeholder: "例如：每天", "aria-label": "營業日" });
        var time = input("text", row.time, { maxlength: "40", placeholder: "例如：18:00 – 24:00", "aria-label": "時間" });

        day.className = "ck-w-day";
        day.addEventListener("input", function () { row.day = day.value; });
        time.addEventListener("input", function () { row.time = time.value; });

        line.appendChild(day);
        line.appendChild(time);
        line.appendChild(removeButton("移除這一行", function () {
          form.hours.splice(index, 1);
          drawHours();
        }));

        hourList.appendChild(line);
      });
    }

    drawHours();

    var address = input("text", data.store.address, { maxlength: "120" });
    var mapUrl = input("url", data.store.map_url, { placeholder: "https://maps.app.goo.gl/…" });

    store.appendChild(sectionTitle("來店資訊"));
    store.appendChild(el("span", "field-label", "營業時間"));
    store.appendChild(hourList);
    store.appendChild(button("＋ 新增一行", "ck-add-row", function () {
      form.hours.push({ day: "", time: "" });
      drawHours();
    }));
    store.appendChild(field("店面地址", address));
    store.appendChild(field("Google 地圖連結", mapUrl, "在 Google 地圖按「分享」複製連結貼在這裡。"));

    wrap.appendChild(store);

    /* ---------- 社群連結 ---------- */

    var social = el("div", "ck-block");
    var lineOfficial = input("url", data.socials.line_official, { placeholder: "https://lin.ee/…" });
    var lineGroup = input("url", data.socials.line_group, { placeholder: "https://line.me/ti/g2/…" });
    var instagram = input("url", data.socials.instagram, { placeholder: "https://instagram.com/…" });
    var sysadmin = input("url", data.socials.sysadmin, { placeholder: "https://line.me/ti/p/…" });

    social.appendChild(sectionTitle("社群連結", "只接受 https:// 開頭的網址。"));
    social.appendChild(field("LINE 官方帳號", lineOfficial));
    social.appendChild(field("LINE 社群", lineGroup));
    social.appendChild(field("Instagram", instagram));
    social.appendChild(field("系統管理員", sysadmin, "例如系統管理員的 LINE 連結。有填才會顯示在官網頁尾和關於我們。"));

    wrap.appendChild(social);

    /* ---------- 關於我們 ---------- */

    var about = el("div", "ck-block");
    var aboutImage = el("div", "ck-poster");
    var aboutText = textarea(data.about.text, { rows: "6", placeholder: "介紹窩室：店的故事、提供什麼、歡迎什麼樣的玩家…" });

    function drawAboutImage() {

      clear(aboutImage);

      if (form.about_image_url) {

        var preview = el("div", "ck-poster-preview");
        var img = el("img");

        img.src = form.about_image_url;
        img.alt = "店面照片預覽";

        preview.appendChild(img);
        preview.appendChild(button("移除", "btn btn-ghost btn-small", function () {
          form.about_image_id = null;
          form.about_image_url = null;
          drawAboutImage();
        }));

        aboutImage.appendChild(preview);

      } else {

        aboutImage.appendChild(button("點一下上傳店面照片", "ck-upload", function () {
          pickAndUploadImage(function (image) {
            form.about_image_id = image.id;
            form.about_image_url = image.url;
            drawAboutImage();
          });
        }));
      }
    }

    drawAboutImage();

    about.appendChild(sectionTitle("關於我們"));
    about.appendChild(aboutImage);
    about.appendChild(aboutText);

    wrap.appendChild(about);

    /* ---------- 常用內容 ---------- */

    var presetBlock = el("div", "ck-block");
    var presetTabs = el("div");
    var presetList = el("div", "ck-list");
    var draft = textarea("", { rows: "3", maxlength: "1000", placeholder: "新增一則常用內容（可以換行）", "aria-label": "新增常用內容" });

    function drawPresets() {

      clear(presetTabs);

      presetTabs.appendChild(segmented(PRESET_FIELDS.map(function (def) {
        return [def.key, def.label];
      }), form.presetTab, function (key) {
        form.presetTab = key;
        drawPresets();
      }));

      clear(presetList);

      var list = form.presets[form.presetTab];

      if (!list.length) {
        presetList.appendChild(el("p", "field-help", "這一類還沒有常用內容。"));
      }

      list.forEach(function (text, index) {

        var row = el("div", "ck-inline ck-subcard");

        row.appendChild(el("span", "ck-name ck-pre", text));
        row.appendChild(removeButton("刪除這則常用內容", function () {
          list.splice(index, 1);
          drawPresets();
        }));

        presetList.appendChild(row);
      });
    }

    function addPreset() {

      var text = draft.value.trim();

      if (!text) {
        return;
      }

      form.presets[form.presetTab].push(text);
      draft.value = "";
      drawPresets();
    }

    var addRow = el("div", "ck-preset-add");

    addRow.appendChild(draft);
    addRow.appendChild(button("＋ 加入這則常用內容", "btn btn-gold btn-block", addPreset));

    drawPresets();

    presetBlock.appendChild(sectionTitle("常用內容", "新增場次時，點欄位旁的「＋」就能從這裡選內容加入。"));
    presetBlock.appendChild(presetTabs);
    presetBlock.appendChild(presetList);
    presetBlock.appendChild(addRow);

    wrap.appendChild(presetBlock);

    main.appendChild(wrap);

    /* ---------- 儲存 ---------- */

    var bar = el("div", "ck-bottom-bar");

    var saveBtn = button("儲存設定", "btn btn-primary btn-block", function () {

      saveBtn.disabled = true;

      api("PUT", "/site", {
        store: { hours: form.hours, address: address.value, map_url: mapUrl.value },
        socials: { line_official: lineOfficial.value, line_group: lineGroup.value, instagram: instagram.value, sysadmin: sysadmin.value },
        about: { text: aboutText.value, image_id: form.about_image_id },
        presets: form.presets
      })
        .then(function (response) {
          ck.presets = response.data.presets;
          toast("已儲存，官網約 1 分鐘內更新。", "success");
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          saveBtn.disabled = false;
        });
    });

    bar.appendChild(saveBtn);
    main.appendChild(bar);
  }


  window.OurSpaceCheckin = {
    tabs: ["events", "checkin", "lottery", "site_settings"],
    render: render,
    stop: stop
  };

})();
