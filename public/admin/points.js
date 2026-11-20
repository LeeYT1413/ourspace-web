/* =========================================================
   OURSPACE / 窩室
   後台：集點卡（建立集點卡、手動加扣點、點數紀錄）
   由 admin.js 呼叫 window.OurSpacePoints.render()
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var API = "/api/referee/points";
  var A = null;

  var pt = { main: null, view: "list", editing: null, cards: [], filterCard: "", picked: null };

  function el(tag, className, text) { return A.el(tag, className, text); }
  function button(text, className, onClick) { return A.button(text, className, onClick); }
  function clear(node) { A.clear(node); }
  function toast(message, type) { A.toast(message, type); }
  function api(method, path, body) { return A.api(method, API + path, body); }

  function errorText(error) {
    var map = {
      REQUIRED: "請把必填的欄位填好。",
      NOT_ENOUGH_POINTS: "點數不夠扣。",
      POINTS_NOT_READY: "官網資料庫還沒執行 0020_points.sql。",
      NOT_FOUND: "找不到這張集點卡或這位會員。",
      BRACKET_NOT_FOUND: "找不到這個賽事 ID，請確認是從對戰表的「複製賽事 ID」複製的。",
      BRACKET_NOT_READY: "比賽賽程資料庫還沒設定。",
      INVALID_BRACKET: "賽事 ID 格式不對。"
    };
    var text = map[error && error.code];
    if (!text) {
      return A.errorText(error);
    }
    if (error && error.data && Array.isArray(error.data.reasons) && error.data.reasons.length) {
      text += "（" + error.data.reasons.join("、") + "）";
    }
    return text;
  }

  function input(type, value, attrs) {
    var node = el("input", "input");
    node.type = type;
    node.value = value === undefined || value === null ? "" : String(value);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
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

  function head(title, right) {
    var box = el("div", "view-head");
    box.appendChild(el("h1", null, title));
    if (right) {
      box.appendChild(right);
    }
    return box;
  }

  function cardSelect(value, emptyLabel) {
    var select = el("select", "ck-select");
    var empty = el("option", null, emptyLabel || "選擇集點卡");
    empty.value = "";
    select.appendChild(empty);
    pt.cards.forEach(function (c) {
      var option = el("option", null, c.name + (c.status === "inactive" ? "（停用）" : ""));
      option.value = String(c.id);
      option.selected = String(value) === String(c.id);
      select.appendChild(option);
    });
    return select;
  }


  /* ---------- 列表 ---------- */

  function load() {
    return api("GET", "/cards").then(function (res) {
      pt.cards = res.data || [];
    });
  }

  function renderList() {

    var main = pt.main;
    clear(main);

    main.appendChild(head("集點卡", button("＋ 新增集點卡", "btn btn-primary", function () {
      pt.view = "edit";
      pt.editing = null;
      render();
    })));

    var grid = el("div", "pc-grid");

    if (!pt.cards.length) {
      grid.appendChild(el("p", "empty", "還沒有集點卡，按「＋ 新增集點卡」建立一張。"));
    }

    pt.cards.forEach(function (c) {

      var card = el("div", "pc-card" + (c.status === "inactive" ? " off" : ""));
      var face = el("div", "pc-face");

      face.style.setProperty("--card-color", c.color || "#C23A2E");

      if (c.image_url) {
        face.style.setProperty("--card-image", "url(\"" + String(c.image_url).replace(/"/g, "") + "\")");
        face.classList.add("has-image");
      }

      face.appendChild(el("strong", null, c.name));
      face.appendChild(el("span", null, c.stamp_goal ? "集滿 " + c.stamp_goal + " 點" : "累積點數"));
      card.appendChild(face);

      var meta = el("div", "pc-meta");
      meta.appendChild(el("span", null, "持卡 " + (c.holders || 0) + " 人・發出 " + (c.issued || 0) + " 點・使用 " + (c.used || 0) + " 點"));
      meta.appendChild(el("span", "ck-tag " + (c.status === "inactive" ? "ck-tag-brown" : "ck-tag-green"), c.status === "inactive" ? "停用" : "顯示中"));
      card.appendChild(meta);

      card.appendChild(button("編輯", "btn btn-ghost btn-small", function () {
        pt.view = "edit";
        pt.editing = c;
        render();
      }));

      grid.appendChild(card);
    });

    main.appendChild(grid);

    if (pt.cards.length) {
      main.appendChild(batchBox());
      main.appendChild(adjustBox());
      main.appendChild(ledgerBox());
    }
  }


  /* ---------- 批次發點：依對戰表的 Round ---------- */

  function batchBox() {

    var box = el("div", "ck-block");
    var card = cardSelect("", "選擇集點卡");
    var code = input("text", "", { maxlength: "20", placeholder: "貼上對戰表的賽事 ID", "aria-label": "對戰表賽事 ID" });
    var roundsBox = el("div", "pc-rounds");
    var rows = [];
    var loadedCode = "";
    var eventId = "";
    var events = null;

    box.appendChild(el("h2", "ck-block-title", "批次發點（依對戰表 Round）"));
    box.appendChild(field("集點卡", card));

    var line = el("div", "ck-inline");
    line.appendChild(code);
    function loadEvents() {
      if (events) {
        return Promise.resolve(events);
      }
      return api("GET", "/events").then(function (res) {
        events = res.data || [];
        return events;
      });
    }

    function preview(value, guessed) {

      Promise.all([api("GET", "/bracket/" + encodeURIComponent(value) + (eventId ? "?event_id=" + eventId : "")), loadEvents()]).then(function (all) {

        var data = all[0].data;

        /* 還沒選場次、也沒綁定過：有同一天的場次就自動用那一場 */
        if (!data.event && !guessed && data.bracket.event_date) {
          var sameDay = events.filter(function (e) { return e.event_date === data.bracket.event_date; });
          if (sameDay.length === 1) {
            eventId = String(sameDay[0].id);
            preview(value, true);
            return;
          }
        }

        eventId = data.event ? String(data.event.id) : "";
        loadedCode = value;
        rows = [];
        clear(roundsBox);

        /* 用哪一場的報到名單對會員 */
        var pick = el("select", "ck-select");
        var none = el("option", null, "不選場次：用會員的主要暱稱對（比較不準）");
        none.value = "";
        pick.appendChild(none);

        events.forEach(function (e) {
          var option = el("option", null, String(e.event_date).replace(/-/g, "/") + " " + e.title + "（報到 " + e.checked + " 人）");
          option.value = String(e.id);
          option.selected = String(e.id) === eventId;
          pick.appendChild(option);
        });

        pick.addEventListener("change", function () {
          eventId = pick.value;
          preview(value, true);
        });

        roundsBox.appendChild(field("用哪一場的報到名單對會員", pick, "「" + data.bracket.title + "」" + (data.event ? "：用場次「" + data.event.title + "」的報到名單對會員。" : "：沒有選場次，用會員的主要暱稱對。")));

        if (!data.rounds.length) {
          roundsBox.appendChild(el("p", "empty", "這張對戰表還沒有開始的場次。"));
          return;
        }

        data.rounds.forEach(function (r) {

          var wrap = el("div", "pc-round");
          var top = el("label", "ck-award-row");
          var check = el("input");
          var points = input("number", "", { min: "1", max: "10000", placeholder: "點數", "aria-label": r.label + " 發幾點" });
          var members = r.players.filter(function (p) { return p.user_id; }).length;
          var guestCount = r.players.filter(function (p) { return !p.user_id && (p.entry_id || p.guest_name); }).length;

          points.classList.add("mm-input");

          check.type = "checkbox";
          points.disabled = true;
          check.addEventListener("change", function () {
            points.disabled = !check.checked;
            if (check.checked) {
              points.focus();
            }
          });

          top.appendChild(check);
          top.appendChild(el("span", "ck-grow", r.label + "・" + r.players.length + " 人（會員 " + members + " 人" + (guestCount ? "、非會員 " + guestCount + " 人" : "") + "）"));
          top.appendChild(points);
          wrap.appendChild(top);

          var names = el("div", "ck-round-names");

          r.players.forEach(function (p) {
            names.appendChild(el("span", "ck-round-name" + (p.user_id ? " won" : (p.entry_id || p.guest_name) ? " guest" : " missing"),
              p.name + (p.user_id && p.member_name && p.member_name !== p.name ? " → " + p.member_name : "") + (p.note ? "（" + p.note + "）" : "")));
          });

          wrap.appendChild(names);
          roundsBox.appendChild(wrap);
          rows.push({ round: r.round, check: check, points: points });
        });

        roundsBox.appendChild(el("p", "field-help", "金色是會員，點數直接記在會員身上；藍色是非會員，點數記在他的選手資料（沒有就另外建立一筆，不用同名的舊資料），之後會員認領就會算到他身上，一年沒認領會自動清除；不在報到名單的（直接在對戰表新增的），有選場次時會加進報到名單、標已報到。虛線是同名會員不只一位、沒辦法判斷的，不會發。同一人在同一張對戰表、同一個 Round、同一張卡只會發一次。"));

        roundsBox.appendChild(button("發點", "btn btn-primary btn-block", function () {

          var picked = rows.filter(function (x) { return x.check.checked; }).map(function (x) {
            return { round: x.round, points: Number(x.points.value) };
          });

          if (!card.value) {
            toast("請先選集點卡。", "error");
            return;
          }

          if (!picked.length || picked.some(function (x) { return !(x.points > 0); })) {
            toast("請勾選 Round，並填發幾點。", "error");
            return;
          }

          api("POST", "/award", { code: loadedCode, card_id: card.value, event_id: eventId || null, rounds: picked })
            .then(function (res) {
              toast("已發點給 " + res.given + " 人次" +
                (res.guests ? "（其中非會員 " + res.guests + " 人次，等認領）" : "") +
                (res.skipped ? "，" + res.skipped + " 人次之前發過了" : "") +
                (res.unmatched ? "，" + res.unmatched + " 人次同名會員不只一位，沒有發" : "") + "。", "success");
              return load().then(render);
            })
            .catch(function (error) { toast(errorText(error), "error"); });
        }));
      }).catch(function (error) { toast(errorText(error), "error"); });
    }

    line.appendChild(button("讀取", "btn btn-gold", function () {

      var value = code.value.trim();

      if (!/^[A-Za-z0-9]{6,20}$/.test(value)) {
        toast("請貼上正確的賽事 ID。", "error");
        return;
      }

      eventId = "";
      preview(value, false);
    }));

    box.appendChild(field("對戰表賽事 ID", line));
    box.appendChild(roundsBox);

    return box;
  }


  /* ---------- 手動加扣點 ---------- */

  function adjustBox() {

    var box = el("div", "ck-block");
    box.appendChild(el("h2", "ck-block-title", "手動加扣點"));

    var card = cardSelect(pt.adjustCard || "", "選擇集點卡");
    card.addEventListener("change", function () { pt.adjustCard = card.value; });
    var search = input("search", "", { placeholder: "搜尋會員：暱稱、電話或會員編號", "aria-label": "搜尋會員" });
    var results = el("div", "pc-results");
    var pickedBox = el("div", "pc-picked");
    var delta = input("number", "", { placeholder: "點數（扣點填負數，例如 -5）", "aria-label": "點數" });
    var reason = input("text", "", { maxlength: "100", placeholder: "原因（例如：兌換飲料）", "aria-label": "原因" });
    var timer = null;

    /* 可以選多位會員；選錯按 × 移除 */
    pt.pickedList = pt.pickedList || [];

    function drawPicked() {
      clear(pickedBox);
      pt.pickedList.forEach(function (m, index) {
        var chip = el("span", "ck-tag ck-tag-gold pc-chip");
        chip.appendChild(el("span", null, m.nickname + "（W" + m.id + "）"));
        chip.appendChild(button("×", "pc-chip-x", function () {
          pt.pickedList.splice(index, 1);
          drawPicked();
        }));
        chip.lastChild.setAttribute("aria-label", "移除 " + m.nickname);
        pickedBox.appendChild(chip);
      });
      if (pt.pickedList.length > 1) {
        pickedBox.appendChild(el("span", "field-help", "共 " + pt.pickedList.length + " 位"));
      }
    }

    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = search.value.trim();
        clear(results);
        if (!q) {
          return;
        }
        api("GET", "/members?q=" + encodeURIComponent(q)).then(function (res) {
          clear(results);
          (res.data || []).forEach(function (m) {
            var already = pt.pickedList.some(function (x) { return x.id === m.id; });
            var pickBtn = button(m.nickname + "・W" + m.id + (m.team_name ? "・" + m.team_name : "") + (already ? "（已選）" : ""), "ck-player-add", function () {
              if (!already) {
                pt.pickedList.push(m);
              }
              clear(results);
              search.value = "";
              drawPicked();
              search.focus();
            });
            pickBtn.disabled = already;
            results.appendChild(pickBtn);
          });
          if (!results.children.length) {
            results.appendChild(el("p", "field-help", "找不到會員。"));
          }
        });
      }, 250);
    });

    box.appendChild(field("集點卡", card));
    box.appendChild(field("會員", search));
    box.appendChild(results);
    box.appendChild(pickedBox);
    box.appendChild(field("點數", delta));
    box.appendChild(field("原因", reason));

    box.appendChild(button("送出", "btn btn-primary btn-block", function () {
      if (!card.value || !pt.pickedList.length || !Number(delta.value)) {
        toast("請選集點卡、會員，並填點數。", "error");
        return;
      }
      api("POST", "/adjust", {
        card_id: card.value,
        user_ids: pt.pickedList.map(function (m) { return m.id; }),
        delta: Number(delta.value),
        reason: reason.value.trim()
      })
        .then(function (res) {
          toast("已登錄 " + ((res && res.count) || pt.pickedList.length) + " 位會員。", "success");
          /* 送出後清空會員、點數、原因（集點卡保留） */
          pt.pickedList = [];
          delta.value = "";
          reason.value = "";
          return load().then(render);
        })
        .catch(function (error) { toast(errorText(error), "error"); });
    }));

    drawPicked();

    return box;
  }


  /* ---------- 點數紀錄 ---------- */

  function ledgerBox() {

    var box = el("div", "ck-block");
    var filter = cardSelect(pt.filterCard, "全部集點卡");
    var list = el("div", "ck-list");

    box.appendChild(el("h2", "ck-block-title", "最近 100 筆點數紀錄"));
    box.appendChild(filter);
    box.appendChild(list);

    function draw() {
      api("GET", "/ledger" + (pt.filterCard ? "?card_id=" + pt.filterCard : "")).then(function (res) {

        clear(list);

        if (!(res.data || []).length) {
          list.appendChild(el("p", "empty", "還沒有紀錄。"));
          return;
        }

        res.data.forEach(function (r) {
          var row = el("div", "pc-row");
          var info = el("div", "pc-grow");
          info.appendChild(el("strong", null, (r.nickname || "W" + r.user_id) + (Number(r.unclaimed) === 1 ? "（非會員・待認領）" : "") + "・" + (r.card_name || "")));
          info.appendChild(el("span", "field-help", String(r.created_at || "").slice(0, 16).replace(/-/g, "/") + "・" + (r.reason || "") + "・" + (r.created_by || "") + "・目前 " + r.balance + " 點"));
          row.appendChild(info);
          row.appendChild(el("strong", r.delta > 0 ? "pc-plus" : "pc-minus", (r.delta > 0 ? "+" : "") + r.delta));
          row.appendChild(button("刪除", "btn btn-ghost btn-small", function () {
            if (!window.confirm("刪除這筆紀錄？點數會跟著回復。")) {
              return;
            }
            api("DELETE", "/ledger/" + r.id)
              .then(function () { toast("已刪除。", "success"); return load().then(render); })
              .catch(function (error) { toast(errorText(error), "error"); });
          }));
          list.appendChild(row);
        });
      }).catch(function (error) { toast(errorText(error), "error"); });
    }

    filter.addEventListener("change", function () {
      pt.filterCard = filter.value;
      draw();
    });

    draw();

    return box;
  }


  /* ---------- 新增／編輯 ---------- */

  function renderEdit() {

    var main = pt.main;
    var c = pt.editing || { status: "active", sort_order: 100 };

    clear(main);

    main.appendChild(head(pt.editing ? "編輯集點卡" : "新增集點卡", button("‹ 集點卡", "btn btn-ghost btn-small", function () {
      pt.view = "list";
      render();
    })));

    var name = input("text", c.name, { maxlength: "40", placeholder: "例如：參賽集點" });
    var desc = el("textarea", "input");
    var color = input("color", c.color || "#C23A2E");
    color.classList.add("pc-color");
    var goal = input("number", c.stamp_goal, { min: "1", max: "50", placeholder: "不填就只顯示點數" });
    var image = input("url", c.image_url, { placeholder: "https://…（選填）" });
    var sort = input("number", c.sort_order === undefined ? 100 : c.sort_order, { min: "0", max: "9999" });
    var status = el("select", "ck-select");

    desc.value = c.description || "";
    desc.rows = 3;
    desc.maxLength = 300;

    [["active", "顯示在我的窩室"], ["inactive", "停用（不顯示）"]].forEach(function (o) {
      var option = el("option", null, o[1]);
      option.value = o[0];
      option.selected = c.status === o[0];
      status.appendChild(option);
    });

    var form = el("div", "ck-block");
    form.appendChild(field("名稱", name));
    form.appendChild(field("說明", desc, "會員在卡片名稱旁的 ⓘ 看得到，例如：集滿 10 點換限定貼紙。"));
    form.appendChild(field("卡面顏色", color));
    form.appendChild(field("集滿幾點", goal, "有填會在卡面顯示格子（最多 50 格）。"));
    form.appendChild(field("卡面背景圖網址", image, "建議 1600 × 1000 像素（8:5 橫式）JPG，500KB 以內。圖片會用 60% 不透明度顯示（不另外蓋深色）；左上放卡名、左側放格子，重點圖案放右側或四周邊框。"));
    form.appendChild(field("顯示順序", sort, "數字小的排前面。"));
    form.appendChild(field("狀態", status));

    form.appendChild(button("儲存", "btn btn-primary btn-block", function () {
      var payload = {
        name: name.value.trim(),
        description: desc.value.trim(),
        color: color.value,
        stamp_goal: goal.value ? Number(goal.value) : null,
        image_url: image.value.trim(),
        sort_order: Number(sort.value),
        status: status.value
      };
      (pt.editing ? api("PUT", "/cards/" + pt.editing.id, payload) : api("POST", "/cards", payload))
        .then(function () {
          toast("已儲存。", "success");
          pt.view = "list";
          return load().then(render);
        })
        .catch(function (error) { toast(errorText(error), "error"); });
    }));

    main.appendChild(form);
  }


  function render(tabId, main) {

    if (main) {
      pt.main = main;
      pt.view = "list";
      clear(main);
      main.appendChild(el("p", "empty", "載入中…"));
      load().then(renderList).catch(function (error) {
        clear(main);
        main.appendChild(head("集點卡"));
        main.appendChild(el("p", "empty", errorText(error)));
      });
      return;
    }

    if (pt.view === "edit") {
      renderEdit();
    } else {
      renderList();
    }
  }

  function stop() {}

  window.OurSpacePoints = {
    tabs: ["point_cards"],
    init: function (admin) { A = admin; },
    render: function (tabId, main) {
      A = A || window.OurSpaceAdmin;
      render(tabId, main);
    },
    stop: stop
  };

})();
