/* =========================================================
   OURSPACE / 窩室
   後台：報到（報到 / 名單 / 賽程）、抽獎（扭蛋機）
   由 admin.js 呼叫 window.OurSpaceCheckin.render()
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var API = "/api/referee/checkin";
  var STORE_KEY = "os_checkin_event";
  var MAX_FIELD = 5;

  var MATCH_STATUS = [[0, "等候"], [1, "準備"], [2, "上場"]];

  var CAPSULE_COLORS = ["#ffe600", "#00d9ff", "#ff3159", "#31f28b", "#ffb020", "#9b5cff"];

  var ERRORS = {
    DUPLICATE_NAME: "這個場次已經有相同名稱的報名。",
    DUPLICATE_NUMBER: "這個參賽號碼已經有人使用。",
    INVALID_NAME: "名稱不可空白、最多 50 字，且不能包含 < >。",
    INVALID_TIME: "請輸入正確的時間。",
    EVENT_NOT_FOUND: "找不到這個場次，畫面已重新整理。",
    ENTRY_NOT_FOUND: "找不到這筆報名，畫面已重新整理。",
    NOTHING_TO_IMPORT: "沒有可匯入的有效名單。",
    TOO_MANY_LINES: "一次最多匯入 300 行。",
    NO_ELIGIBLE: "已經沒有可以抽的人（已報到且還沒中獎）。",
    WIN_NOT_FOUND: "這筆中獎紀錄已不存在。"
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
    sub: "checkin",
    entries: [],
    selectedId: null,
    content: null,
    playerTimer: null,
    drawing: false
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

  function isAdmin() {
    var staff = A.staff();
    return !!staff && staff.role === "admin";
  }

  function pad2(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function localToday() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function currentEvent() {
    for (var i = 0; i < ck.events.length; i++) {
      if (ck.events[i].id === ck.eventId) {
        return ck.events[i];
      }
    }
    return null;
  }

  function eventLabel(event) {

    var parts = event.event_date.split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var week = "日一二三四五六".charAt(date.getDay());

    return (
      parts[1] + "/" + parts[2] + "（" + week + "）" +
      (event.start_time ? " " + event.start_time : "") +
      " " + event.title +
      (event.event_date === ck.today ? " ・今天" : "")
    );
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

  function playerLabel(entry) {
    return (entry.checkin_number ? entry.checkin_number + "- " : "") + entry.nickname;
  }


  /* =======================================================
     入口
  ======================================================= */

  function render(tabId, main) {

    A = window.OurSpaceAdmin;

    ck.tab = tabId;
    ck.main = main;
    ck.selectedId = null;

    clear(main);
    main.appendChild(el("p", "empty", "載入中…"));

    loadEvents().then(drawView);
  }


  function stop() {

    if (ck.playerTimer) {
      clearTimeout(ck.playerTimer);
      ck.playerTimer = null;
    }

    closeModal();
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


  /* 預設：上次選的 → 今天第一場 → 下一個未來場次 → 最近一場 */
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
      if (ck.events[i].event_date >= ck.today) {
        ck.eventId = ck.events[i].id;
        return;
      }
    }

    if (ck.events.length) {
      ck.eventId = ck.events[ck.events.length - 1].id;
    }
  }


  function drawView() {

    var main = ck.main;

    clear(main);

    var head = el("div", "view-head");
    head.appendChild(el("h1", null, ck.tab === "lottery" ? "抽獎" : "報到"));

    var tools = el("div", "view-tools");

    if (ck.events.length) {

      var select = el("select", "ck-event-select");
      select.setAttribute("aria-label", "場次");

      ck.events.forEach(function (event) {

        var option = el("option", null, eventLabel(event));
        option.value = String(event.id);
        option.selected = event.id === ck.eventId;

        select.appendChild(option);
      });

      select.addEventListener("change", function () {
        ck.eventId = Number(select.value);
        ck.selectedId = null;
        saveSelection();
        drawView();
      });

      tools.appendChild(select);

      tools.appendChild(button("編輯場次", "btn btn-ghost", function () {
        openEventForm(currentEvent());
      }));
    }

    tools.appendChild(button("＋ 新增場次", "btn btn-primary", function () {
      openEventForm(null);
    }));

    head.appendChild(tools);
    main.appendChild(head);

    if (!ck.events.length || !currentEvent()) {

      var empty = el("div", "empty");
      empty.appendChild(el("p", null, "還沒有場次。先新增一個場次（例如今天的比賽），再開始報到。"));
      main.appendChild(empty);
      return;
    }

    saveSelection();

    ck.content = el("div", "ck-content");
    main.appendChild(ck.content);

    if (ck.tab === "lottery") {
      drawLottery();
    } else {
      drawCheckinTabs();
    }
  }


  /* =======================================================
     場次表單
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

    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeModal();
      }
    });

    var first = bodyNode.querySelector("input, textarea, select");

    if (first) {
      setTimeout(function () { first.focus(); }, 50);
    }
  }


  function field(label, input, help, extraClass) {

    var wrap = el("label", "field" + (extraClass ? " " + extraClass : ""));

    wrap.appendChild(el("span", "field-label", label));
    wrap.appendChild(input);

    if (help) {
      wrap.appendChild(el("span", "field-help", help));
    }

    return wrap;
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


  function openEventForm(event) {

    var isEdit = !!event;
    var bodyNode = el("div", "panel-body");

    var dateInput = input("date", isEdit ? event.event_date : ck.today);
    var titleInput = input("text", isEdit ? event.title : "", { maxlength: "50", placeholder: "例如：窩室日常賽" });
    var timeInput = input("time", isEdit ? event.start_time : "");
    var minInput = input("number", isEdit ? event.lottery_min_players : 0, { min: "0", max: "999", step: "1", inputmode: "numeric" });
    var noteInput = input("text", isEdit ? event.note : "", { maxlength: "200" });

    var publicBox = input("checkbox", "");
    publicBox.checked = isEdit ? Number(event.is_public) === 1 : true;

    var publicWrap = el("label", "field ck-check-field");
    publicWrap.appendChild(publicBox);
    publicWrap.appendChild(el("span", null, "在官網「名單」頁公開"));

    bodyNode.appendChild(field("日期", dateInput, null, "field-half"));
    bodyNode.appendChild(field("開始時間（選填）", timeInput, null, "field-half"));
    bodyNode.appendChild(field("場次名稱", titleInput));
    bodyNode.appendChild(field("抽獎門檻（人）", minInput, "報到人數未達門檻時，抽獎會先跳提醒。0 = 不限制。"));
    bodyNode.appendChild(field("備註（選填，會顯示在官網）", noteInput));
    bodyNode.appendChild(publicWrap);

    var buttons = [];

    if (isEdit && isAdmin()) {
      buttons.push(button("刪除", "btn btn-danger", function () {

        if (!window.confirm("確定要刪除「" + event.title + "」？\n名單、賽程和抽獎紀錄都會一起刪除，無法復原。")) {
          return;
        }

        api("DELETE", "/events/" + event.id)
          .then(function () {
            closeModal();
            toast("場次已刪除。", "success");
            ck.eventId = null;
            return loadEvents().then(drawView);
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));
    }

    buttons.push(el("span", "panel-foot-space"));
    buttons.push(button("取消", "btn btn-ghost", closeModal));

    var saveBtn = button("儲存", "btn btn-primary", function () {

      saveBtn.disabled = true;

      api(isEdit ? "PUT" : "POST", isEdit ? "/events/" + event.id : "/events", {
        event_date: dateInput.value,
        title: titleInput.value,
        start_time: timeInput.value,
        lottery_min_players: minInput.value === "" ? 0 : minInput.value,
        is_public: publicBox.checked ? 1 : 0,
        note: noteInput.value
      })
        .then(function (response) {

          closeModal();
          toast(isEdit ? "場次已更新。" : "場次已新增。", "success");

          ck.eventId = response.data.id;

          return loadEvents().then(drawView);
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          saveBtn.disabled = false;
        });
    });

    buttons.push(saveBtn);

    openModal(isEdit ? "編輯場次" : "新增場次", bodyNode, buttons);
  }


  /* =======================================================
     報到分頁：報到 / 名單 / 賽程
  ======================================================= */

  function drawCheckinTabs() {

    var chips = el("div", "date-chips ck-subtabs");

    [["checkin", "報到"], ["list", "名單"], ["match", "賽程"]].forEach(function (item) {

      var chip = button(item[1], "chip" + (ck.sub === item[0] ? " active" : ""), function () {
        ck.sub = item[0];
        drawCheckinTabs();
      });

      chips.appendChild(chip);
    });

    clear(ck.content);
    ck.content.appendChild(chips);

    var area = el("div");
    area.appendChild(el("p", "empty", "載入中…"));
    ck.content.appendChild(area);

    loadEntries().then(function () {

      if (ck.sub === "list") {
        drawList(area);
      } else if (ck.sub === "match") {
        drawMatch(area);
      } else {
        drawCheckin(area);
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

        if (error.code === "EVENT_NOT_FOUND") {
          ck.eventId = null;
          return loadEvents().then(drawView);
        }
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


  function countLine() {

    var checked = ck.entries.filter(function (e) { return Number(e.checked_in) === 1; }).length;
    var event = currentEvent();
    var text = "已報到 " + checked + " 人；報名 " + ck.entries.length + " 人";

    if (event && Number(event.lottery_min_players) > 0) {
      text += "；抽獎門檻 " + event.lottery_min_players + " 人";
    }

    return el("p", "view-hint ck-count", text);
  }


  /* ---------- 報到 ---------- */

  function drawCheckin(area) {

    clear(area);

    area.appendChild(countLine());

    var bar = el("div", "ck-search-bar");

    var search = input("search", "", { placeholder: "搜尋或輸入參賽名稱", autocomplete: "off" });
    search.className = "search ck-search";

    var addBtn = button("＋", "btn btn-primary ck-add", function () {
      addEntry(search.value, null);
    });
    addBtn.setAttribute("aria-label", "新增報名");

    bar.appendChild(search);
    bar.appendChild(addBtn);
    area.appendChild(bar);

    var suggest = el("div", "ck-suggest");
    area.appendChild(suggest);

    var panelBox = el("div", "ck-panel-box");
    area.appendChild(panelBox);

    function refreshSuggest() {

      var keyword = search.value.trim().toLowerCase();

      clear(suggest);

      if (ck.playerTimer) {
        clearTimeout(ck.playerTimer);
        ck.playerTimer = null;
      }

      if (!keyword) {
        return;
      }

      var matched = ck.entries.filter(function (entry) {
        return entry.nickname.toLowerCase().indexOf(keyword) !== -1;
      }).slice(0, 20);

      matched.forEach(function (entry) {

        var item = button("", "ck-suggest-item");
        item.appendChild(el("span", "ck-suggest-name", playerLabel(entry)));
        item.appendChild(el(
          "span",
          Number(entry.checked_in) === 1 ? "ck-tag ck-tag-on" : "ck-tag",
          Number(entry.checked_in) === 1 ? "已報到" : "未報到"
        ));

        item.addEventListener("click", function () {
          openEntryPanel(entry.id, panelBox, search, suggest);
        });

        suggest.appendChild(item);
      });

      /* 名單裡沒有的話，再從官網選手資料找 */
      var playerBox = el("div");
      suggest.appendChild(playerBox);

      var keywordAtStart = search.value.trim();

      ck.playerTimer = setTimeout(function () {

        api("GET", "/players?q=" + encodeURIComponent(keywordAtStart))
          .then(function (response) {

            if (search.value.trim() !== keywordAtStart) {
              return;
            }

            var existing = {};

            ck.entries.forEach(function (entry) {
              existing[entry.nickname.toLowerCase()] = true;
            });

            (response.data || []).forEach(function (player) {

              var name = player.nickname || player.player_name;

              if (existing[name.toLowerCase()]) {
                return;
              }

              var item = button("", "ck-suggest-item ck-suggest-player");
              item.appendChild(el("span", "ck-suggest-name", name));
              item.appendChild(el("span", "ck-tag", (player.team_name ? player.team_name + "・" : "") + "官網選手＋"));

              item.addEventListener("click", function () {
                addEntry(name, player.id);
              });

              playerBox.appendChild(item);
            });
          })
          .catch(function () {
            /* 找不到選手資料不影響報到 */
          });
      }, 300);
    }

    function addEntry(name, playerId) {

      name = String(name || "").trim();

      if (!name) {
        toast("請先輸入參賽名稱。", "error");
        search.focus();
        return;
      }

      addBtn.disabled = true;

      api("POST", "/events/" + ck.eventId + "/entries", { nickname: name, player_id: playerId })
        .then(function (response) {
          ck.entries.push(response.data);
          toast("已新增報名：" + name, "success");
          openEntryPanel(response.data.id, panelBox, search, suggest);
        })
        .catch(function (error) {

          toast(errorText(error), "error");

          /* 別台裝置已經新增過：重新載入後直接打開那一筆 */
          if (error.code === "DUPLICATE_NAME") {
            loadEntries().then(function () {
              var lower = name.toLowerCase();
              ck.entries.forEach(function (entry) {
                if (entry.nickname.toLowerCase() === lower) {
                  openEntryPanel(entry.id, panelBox, search, suggest);
                }
              });
            });
          }
        })
        .then(function () {
          addBtn.disabled = false;
        });
    }

    search.addEventListener("input", refreshSuggest);

    search.addEventListener("keydown", function (event) {

      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();

      /* Enter：剛好只有一筆符合就直接打開 */
      var keyword = search.value.trim().toLowerCase();
      var matched = ck.entries.filter(function (entry) {
        return entry.nickname.toLowerCase().indexOf(keyword) !== -1;
      });

      if (keyword && matched.length === 1) {
        openEntryPanel(matched[0].id, panelBox, search, suggest);
      }
    });

    if (ck.selectedId && findEntry(ck.selectedId)) {
      openEntryPanel(ck.selectedId, panelBox, search, suggest);
    } else {
      setTimeout(function () { search.focus(); }, 50);
    }
  }


  function openEntryPanel(entryId, panelBox, search, suggest) {

    var entry = findEntry(entryId);

    if (!entry) {
      return;
    }

    ck.selectedId = entryId;

    clear(suggest);
    clear(panelBox);

    var card = el("div", "ck-card");

    card.appendChild(el("h2", "ck-card-name", entry.nickname));

    var checkBox = input("checkbox", "");
    checkBox.className = "ck-big-check";
    checkBox.checked = Number(entry.checked_in) === 1;

    var checkLabel = el("label", "ck-check-row");
    checkLabel.appendChild(checkBox);
    checkLabel.appendChild(el("span", null, "已報到"));

    var numberInput = input("number", entry.checkin_number, {
      min: "1",
      step: "1",
      inputmode: "numeric",
      placeholder: "留空自動編號"
    });
    numberInput.className = "ck-number";

    var judgeBox = input("checkbox", "");
    judgeBox.className = "ck-big-check";
    judgeBox.checked = Number(entry.is_judge) === 1;

    var judgeLabel = el("label", "ck-check-row");
    judgeLabel.appendChild(judgeBox);
    judgeLabel.appendChild(el("span", null, "裁判 ㊣"));

    checkBox.addEventListener("change", function () {

      /* 取消報到：清空號碼與裁判 */
      if (!checkBox.checked) {
        numberInput.value = "";
        judgeBox.checked = false;
      }
    });

    card.appendChild(checkLabel);
    card.appendChild(field("參賽號碼", numberInput));
    card.appendChild(judgeLabel);

    var saveBtn = button("💾 儲存", "btn btn-primary btn-block ck-big-btn", save);
    var cancelBtn = button("取消", "btn btn-ghost btn-block ck-big-btn", reset);
    var deleteBtn = button("刪除這筆報名", "btn btn-danger btn-small ck-delete", function () {

      if (!window.confirm("確定要刪除「" + entry.nickname + "」的報名？")) {
        return;
      }

      api("DELETE", "/entries/" + entry.id)
        .then(function () {
          toast("已刪除報名。", "success");
          ck.entries = ck.entries.filter(function (e) { return e.id !== entry.id; });
          reset();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    });

    card.appendChild(saveBtn);
    card.appendChild(cancelBtn);
    card.appendChild(deleteBtn);

    panelBox.appendChild(card);

    numberInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });

    /* 未報到的人：打開就先勾好，按 Enter / 儲存即可完成報到 */
    if (!checkBox.checked) {
      checkBox.checked = true;
    }

    setTimeout(function () { numberInput.focus(); }, 50);

    function reset() {

      ck.selectedId = null;
      clear(panelBox);
      search.value = "";
      clear(suggest);

      var hint = ck.content.querySelector(".ck-count");

      if (hint && hint.parentNode) {
        hint.parentNode.replaceChild(countLine(), hint);
      }

      search.focus();
    }

    function save() {

      saveBtn.disabled = true;

      api("PUT", "/entries/" + entry.id, {
        checked_in: checkBox.checked ? 1 : 0,
        checkin_number: checkBox.checked ? numberInput.value : "",
        is_judge: judgeBox.checked ? 1 : 0
      })
        .then(function (response) {

          var updated = response.data;

          ck.entries = ck.entries.map(function (e) {
            return e.id === updated.id ? updated : e;
          });

          toast(
            Number(updated.checked_in) === 1
              ? "已報到：" + playerLabel(updated) + (Number(updated.is_judge) === 1 ? " ㊣" : "")
              : "已取消報到：" + updated.nickname,
            "success"
          );

          reset();
        })
        .catch(function (error) {

          toast(errorText(error), "error");

          if (error.code === "DUPLICATE_NUMBER") {
            numberInput.select();
          }
        })
        .then(function () {
          saveBtn.disabled = false;
        });
    }
  }


  /* ---------- 名單 ---------- */

  function drawList(area) {

    clear(area);

    area.appendChild(countLine());

    var tools = el("div", "view-tools ck-list-tools");

    tools.appendChild(button("📋 複製名單（同戰隊打散）", "btn btn-primary", copyList));
    tools.appendChild(button("📥 匯入名單", "btn btn-ghost", openImport));
    tools.appendChild(button("重新整理", "btn btn-ghost", function () {
      drawCheckinTabs();
    }));

    area.appendChild(tools);

    if (!ck.entries.length) {
      area.appendChild(el("p", "empty", "這個場次還沒有人報名。可以在「報到」新增，或用「匯入名單」一次貼上。"));
      return;
    }

    var wrap = el("div", "table-wrap");
    var table = el("table", "table ck-table");
    var thead = el("thead");
    var headRow = el("tr");

    ["報到", "號碼", "參賽名稱", "裁判", "中獎"].forEach(function (label) {
      headRow.appendChild(el("th", null, label));
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody");

    ck.entries.forEach(function (entry) {

      var tr = el("tr", "row");
      tr.tabIndex = 0;

      tr.appendChild(el("td", "ck-center", Number(entry.checked_in) === 1 ? "✅" : "❌"));
      tr.appendChild(el("td", "ck-center", entry.checkin_number || ""));
      tr.appendChild(el("td", "ck-center", entry.nickname));
      tr.appendChild(el("td", "ck-center", Number(entry.is_judge) === 1 ? "㊣" : ""));
      tr.appendChild(el("td", "ck-center", Number(entry.has_won) === 1 ? "🎁" : ""));

      function edit() {
        ck.selectedId = entry.id;
        ck.sub = "checkin";
        drawCheckinTabs();
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
    wrap.appendChild(table);
    area.appendChild(wrap);
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
      return playerLabel(entry) + (Number(entry.is_judge) === 1 ? " ㊣" : "");
    }).join("\n");
  }


  function copyList() {

    var text = buildCopyText();

    if (!text) {
      toast("目前沒有已報到的選手。", "error");
      return;
    }

    function fallback() {

      var area = el("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";

      document.body.appendChild(area);
      area.select();

      var ok = false;

      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }

      document.body.removeChild(area);

      if (ok) {
        toast("已打散並複製名單。", "success");
      } else {
        toast("複製失敗，請手動複製。", "error");
      }
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

    var textArea = el("textarea", "ck-import-text");
    textArea.rows = 12;
    textArea.placeholder = "每行一位參賽者，空白行會自動跳過\n例如：\n小明\n小華\n小王";

    bodyNode.appendChild(field("戰隊名（選填，會加在每個名字前面）", teamInput));
    bodyNode.appendChild(field("參賽名單", textArea, "同場次已經有的名字會自動略過。"));

    var importBtn = button("開始匯入", "btn btn-primary", function () {

      if (!textArea.value.trim()) {
        toast("請先貼上參賽名單。", "error");
        textArea.focus();
        return;
      }

      importBtn.disabled = true;

      api("POST", "/events/" + ck.eventId + "/import", {
        team_prefix: teamInput.value,
        text: textArea.value
      })
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
          drawCheckinTabs();
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


  /* ---------- 賽程 ---------- */

  function drawMatch(area) {

    clear(area);

    var tools = el("div", "view-tools ck-list-tools");
    tools.appendChild(button("重新整理（重新排序）", "btn btn-ghost", function () {
      drawCheckinTabs();
    }));
    area.appendChild(tools);

    var list = ck.entries.filter(function (e) { return Number(e.checked_in) === 1; });

    if (!list.length) {
      area.appendChild(el("p", "empty", "目前沒有已報到的選手。"));
      return;
    }

    /* 上場 → 準備 → 等候；同狀態依場地、號碼 */
    list.sort(function (a, b) {
      return (
        (b.match_status - a.match_status) ||
        (a.match_field - b.match_field) ||
        ((a.checkin_number || 0) - (b.checkin_number || 0))
      );
    });

    var wrap = el("div", "table-wrap");
    var table = el("table", "table ck-table");
    var thead = el("thead");
    var headRow = el("tr");

    ["號碼", "參賽名稱", "裁判", "場次", "狀態", "場地"].forEach(function (label) {
      headRow.appendChild(el("th", null, label));
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody");

    list.forEach(function (entry) {

      var tr = el("tr", "ck-status-" + entry.match_status);

      tr.appendChild(el("td", "ck-center", entry.checkin_number || ""));
      tr.appendChild(el("td", "ck-center", entry.nickname));
      tr.appendChild(el("td", "ck-center", Number(entry.is_judge) === 1 ? "㊣" : ""));

      var scheduleInput = input("number", entry.match_schedule || 0, { min: "0", max: "999", step: "1", inputmode: "numeric" });
      scheduleInput.className = "ck-mini-number";

      var fieldInput = input("number", entry.match_field || 0, { min: "0", max: String(MAX_FIELD), step: "1", inputmode: "numeric" });
      fieldInput.className = "ck-mini-number";

      var statusBox = el("div", "ck-seg");
      var status = Number(entry.match_status) || 0;

      MATCH_STATUS.forEach(function (item) {

        var seg = button(item[1], "ck-seg-btn" + (status === item[0] ? " active" : ""), function () {

          status = item[0];

          Array.prototype.forEach.call(statusBox.children, function (node, index) {
            node.classList.toggle("active", MATCH_STATUS[index][0] === status);
          });

          tr.className = "ck-status-" + status;
          save();
        });

        statusBox.appendChild(seg);
      });

      function save() {

        var schedule = Math.max(0, parseInt(scheduleInput.value, 10) || 0);
        var fieldNo = Math.min(MAX_FIELD, Math.max(0, parseInt(fieldInput.value, 10) || 0));

        scheduleInput.value = schedule;
        fieldInput.value = fieldNo;

        api("PUT", "/entries/" + entry.id + "/match", {
          match_schedule: schedule,
          match_status: status,
          match_field: fieldNo
        })
          .then(function (response) {
            entry.match_schedule = response.data.match_schedule;
            entry.match_status = response.data.match_status;
            entry.match_field = response.data.match_field;
          })
          .catch(function (error) {
            toast("賽程更新失敗：" + errorText(error), "error");
          });
      }

      scheduleInput.addEventListener("change", save);
      fieldInput.addEventListener("change", save);

      var tdSchedule = el("td", "ck-center");
      tdSchedule.appendChild(scheduleInput);

      var tdStatus = el("td", "ck-center");
      tdStatus.appendChild(statusBox);

      var tdField = el("td", "ck-center");
      tdField.appendChild(fieldInput);

      tr.appendChild(tdSchedule);
      tr.appendChild(tdStatus);
      tr.appendChild(tdField);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    area.appendChild(wrap);
  }


  /* =======================================================
     抽獎：扭蛋機
  ======================================================= */

  var lot = {
    data: null,
    info: null,
    stage: null,
    machine: null,
    capsule: null,
    result: null,
    winners: null,
    drawBtn: null,
    prizeInput: null
  };


  function drawLottery() {

    clear(ck.content);

    lot.info = el("div", "ck-lot-info");
    lot.info.appendChild(el("p", "view-hint", "載入中…"));

    lot.stage = el("div", "ck-lot-stage");

    /* 扭蛋機本體（全部用 CSS 畫，不用圖片） */
    var machine = el("div", "gacha");
    var dome = el("div", "gacha-dome");

    /* 罩子裡的扭蛋：由下往上堆成 5 / 4 / 3 / 2 顆 */
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

    machine.appendChild(el("div", "gacha-sign", "OURSPACE"));
    machine.appendChild(dome);
    machine.appendChild(bodyNode);

    lot.machine = machine;
    lot.stage.appendChild(machine);

    lot.result = el("div", "gacha-result");
    lot.result.hidden = true;
    lot.result.addEventListener("click", function () {
      lot.result.hidden = true;
    });
    lot.stage.appendChild(lot.result);

    var controls = el("div", "ck-lot-controls");

    lot.prizeInput = input("text", "", { maxlength: "50", placeholder: "獎項（選填），例如：一番賞券" });
    lot.prizeInput.className = "search ck-prize";

    lot.drawBtn = button("🎲 轉動扭蛋", "btn btn-primary ck-big-btn ck-draw", startDraw);

    var fullBtn = button("全螢幕", "btn btn-ghost", function () {

      var target = lot.stage;

      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (target.requestFullscreen) {
        target.requestFullscreen().catch(function () {});
      }
    });

    controls.appendChild(lot.prizeInput);
    controls.appendChild(lot.drawBtn);
    controls.appendChild(fullBtn);

    lot.winners = el("div", "ck-winners");

    ck.content.appendChild(lot.info);
    ck.content.appendChild(lot.stage);
    ck.content.appendChild(controls);
    ck.content.appendChild(lot.winners);

    loadLottery();
  }


  function loadLottery() {

    return api("GET", "/events/" + ck.eventId + "/lottery")
      .then(function (response) {
        lot.data = response.data;
        renderLotteryInfo();
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  function renderLotteryInfo() {

    var data = lot.data;

    if (!data) {
      return;
    }

    clear(lot.info);

    var stats = el("div", "ck-lot-stats");

    function stat(label, value, warn) {
      var box = el("div", "ck-stat" + (warn ? " ck-stat-warn" : ""));
      box.appendChild(el("strong", null, value));
      box.appendChild(el("span", null, label));
      stats.appendChild(box);
    }

    var below = data.threshold > 0 && data.checked_count < data.threshold;

    stat("已報到", data.checked_count + " 人");
    stat("抽獎門檻", data.threshold > 0 ? data.threshold + " 人" : "不限", below);
    stat("可抽人數", data.eligible_count + " 人");

    lot.info.appendChild(stats);

    if (below) {
      lot.info.appendChild(el(
        "p",
        "ck-lot-warn",
        "⚠ 報到人數還差 " + (data.threshold - data.checked_count) + " 人才達抽獎門檻，仍可抽獎，抽之前會再提醒一次。"
      ));
    }

    clear(lot.winners);

    var title = el("div", "sub-head");
    title.appendChild(el("span", "sub-title", "中獎紀錄"));
    title.appendChild(el("span", "sub-count", data.wins.length + " 人"));
    lot.winners.appendChild(title);

    if (!data.wins.length) {
      lot.winners.appendChild(el("p", "placement-empty", "還沒有人中獎。"));
      return;
    }

    data.wins.forEach(function (win) {

      var row = el("div", "placement-row ck-win-row");
      var info = el("div", "placement-info");

      info.appendChild(el("strong", null, playerLabel(win) + (Number(win.is_judge) === 1 ? " ㊣" : "")));
      info.appendChild(el("span", null, (win.prize ? win.prize + "・" : "") + utcTime(win.drawn_at)));

      row.appendChild(info);

      row.appendChild(button("撤銷", "btn btn-ghost btn-small", function () {

        if (!window.confirm("撤銷「" + win.nickname + "」的中獎？撤銷後這位選手可以再被抽到。")) {
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

      lot.winners.appendChild(row);
    });
  }


  /* D1 的 CURRENT_TIMESTAMP 是 UTC，轉成台灣時間 HH:MM */
  function utcTime(value) {

    if (!value) {
      return "";
    }

    var date = new Date(String(value).replace(" ", "T") + "Z");

    if (isNaN(date.getTime())) {
      return "";
    }

    var tw = new Date(date.getTime() + 8 * 3600 * 1000);

    return pad2(tw.getUTCHours()) + ":" + pad2(tw.getUTCMinutes());
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
    var confirmed = false;

    if (data.threshold > 0 && data.checked_count < data.threshold) {

      if (!window.confirm(
        "報到人數 " + data.checked_count + " 人，未達抽獎門檻 " + data.threshold + " 人。\n確定仍要抽獎嗎？"
      )) {
        return;
      }

      confirmed = true;
    }

    if (!data.eligible_count) {
      toast(ERRORS.NO_ELIGIBLE, "error");
      return;
    }

    runDraw(confirmed);
  }


  function runDraw(confirmed) {

    ck.drawing = true;
    lot.drawBtn.disabled = true;
    lot.result.hidden = true;

    var color = CAPSULE_COLORS[Math.floor(Math.random() * CAPSULE_COLORS.length)];

    lot.capsule.style.setProperty("--c", color);
    lot.machine.classList.remove("is-dropping", "is-open");
    void lot.machine.offsetWidth;
    lot.machine.classList.add("is-spinning");

    var request = api("POST", "/events/" + ck.eventId + "/lottery", {
      prize: lot.prizeInput.value,
      confirm_below_threshold: confirmed
    });

    Promise.all([request, wait(1800)])
      .then(function (results) {

        var response = results[0];

        lot.machine.classList.remove("is-spinning");
        lot.machine.classList.add("is-dropping");

        return wait(900).then(function () {

          lot.machine.classList.add("is-open");

          return wait(350).then(function () {
            showWinner(response.winner, color);
            lot.data = response.data;
            renderLotteryInfo();
          });
        });
      })
      .catch(function (error) {

        lot.machine.classList.remove("is-spinning", "is-dropping", "is-open");

        /* 資料已被別台更新：門檻提醒 */
        if (error.code === "BELOW_THRESHOLD" && error.data) {

          lot.data = error.data;
          renderLotteryInfo();

          ck.drawing = false;
          lot.drawBtn.disabled = false;

          if (window.confirm(
            "報到人數 " + error.data.checked_count + " 人，未達抽獎門檻 " + error.data.threshold + " 人。\n確定仍要抽獎嗎？"
          )) {
            runDraw(true);
          }

          return;
        }

        if (error.data) {
          lot.data = error.data;
          renderLotteryInfo();
        }

        toast(errorText(error), "error");
      })
      .then(function () {

        if (ck.drawing && !lot.machine.classList.contains("is-spinning")) {
          ck.drawing = false;
          lot.drawBtn.disabled = false;
        }
      });
  }


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

    card.appendChild(el("div", "gacha-result-hint", "點一下關閉"));

    lot.result.appendChild(card);
    lot.result.hidden = false;
  }


  window.OurSpaceCheckin = {
    tabs: ["checkin", "lottery"],
    render: render,
    stop: stop
  };

})();
