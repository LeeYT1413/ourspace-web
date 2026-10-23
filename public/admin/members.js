/* =========================================================
   OURSPACE / 窩室
   後台：審核中心、會員管理
   由 admin.js 呼叫 window.OurSpaceMembers.render()
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var API = "/api/referee/members";
  var A = null;

  var mm = {
    main: null,
    reviewTab: "claims",
    filter: "all",
    keyword: "",
    timer: null
  };

  function el(tag, className, text) { return A.el(tag, className, text); }
  function button(text, className, onClick) { return A.button(text, className, onClick); }
  function clear(node) { A.clear(node); }
  function toast(message, type) { A.toast(message, type); }
  function api(method, path, body) { return A.api(method, API + path, body); }

  function errorText(error) {
    return A.errorText(error);
  }

  function head(title, right) {
    var box = el("div", "view-head");
    box.appendChild(el("h1", null, title));
    if (right) {
      box.appendChild(right);
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

  function img(src, className, alt) {
    var node = el("img", className);
    node.src = src;
    node.alt = alt || "";
    return node;
  }


  /* =======================================================
     入口
  ======================================================= */

  function render(tabId, main) {

    A = window.OurSpaceAdmin;
    mm.main = main;

    clear(main);
    main.appendChild(el("p", "empty", "載入中…"));

    if (tabId === "review") {
      renderReview();
    } else {
      renderMembers();
    }
  }

  function stop() {
    clearTimeout(mm.timer);
    closeSheet();
  }


  /* =======================================================
     審核中心
  ======================================================= */

  function renderReview() {

    var load = mm.reviewTab === "history" ? api("GET", "/review/history") : api("GET", "/review");

    load.then(function (response) {

      var main = mm.main;

      clear(main);
      main.appendChild(head("審核中心"));

      var claims = response.claims || [];
      var edits = response.edits || [];

      main.appendChild(segmented([
        ["claims", "選手認領" + (mm.reviewTab !== "history" ? " " + claims.length : "")],
        ["edits", "戰隊修改" + (mm.reviewTab !== "history" ? " " + edits.length : "")],
        ["history", "已處理"]
      ], mm.reviewTab, function (tab) {
        mm.reviewTab = tab;
        renderReview();
      }));

      var list = el("div", "ck-cards");

      if (mm.reviewTab === "claims") {

        if (!claims.length) {
          list.appendChild(el("p", "empty", "目前沒有待審核的選手認領。"));
        }

        claims.forEach(function (c) {
          list.appendChild(claimCard(c));
        });

      } else if (mm.reviewTab === "edits") {

        if (!edits.length) {
          list.appendChild(el("p", "empty", "目前沒有待審核的戰隊修改。"));
        }

        edits.forEach(function (e) {
          list.appendChild(editCard(e));
        });

      } else {

        var rows = response.data || [];

        if (!rows.length) {
          list.appendChild(el("p", "empty", "還沒有處理過的項目。"));
        }

        rows.forEach(function (r) {

          var row = el("div", "mm-history");
          var info = el("div", "mm-grow");

          info.appendChild(el("strong", null, r.kind === "claim"
            ? "選手認領：" + r.player + " → " + r.member
            : "戰隊修改：" + r.team_name));
          info.appendChild(el("span", "mm-sub", (r.reviewed_at || "") + "・" + (r.by || "") + (r.note ? "・" + r.note : "")));

          row.appendChild(info);
          row.appendChild(el("span", "ck-tag " + (r.status === "approved" ? "ck-tag-green" : "ck-tag-brown"), r.status === "approved" ? "已核准" : "已退回"));
          list.appendChild(row);
        });
      }

      main.appendChild(list);
    }).catch(function (error) {
      toast(errorText(error), "error");
    });
  }


  function decide(kind, id, approve, label) {

    var note = null;

    if (!approve) {
      note = window.prompt("退回原因（選填，會員會看到）", "");
      if (note === null) {
        return;
      }
    }

    api("POST", "/" + kind + "/" + id + "/" + (approve ? "approve" : "reject"), { note: note })
      .then(function () {
        toast((approve ? "已核准：" : "已退回：") + label, "success");
        renderReview();
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  function claimCard(c) {

    var card = el("div", "ck-card");
    var tags = el("div", "ck-tags");

    tags.appendChild(el("span", "ck-tag ck-tag-navy", "選手認領"));
    tags.appendChild(el("span", "ck-tag-note", c.created_at || ""));
    card.appendChild(tags);

    var pair = el("div", "mm-pair");
    var left = el("div", "mm-box");
    var right = el("div", "mm-box");

    left.appendChild(el("span", "mm-sub", "申請的會員"));
    left.appendChild(el("strong", null, c.member));
    left.appendChild(el("span", "mm-sub", c.phone_tail || ""));

    right.appendChild(el("span", "mm-sub", "要認領的選手資料"));
    right.appendChild(el("strong", null, c.player));
    right.appendChild(el("span", "mm-sub", (c.team_name || "未加入戰隊") + "・上位 " + c.upper_count + " 次"));

    pair.appendChild(left);
    pair.appendChild(el("span", "mm-arrow", "→"));
    pair.appendChild(right);
    card.appendChild(pair);

    if (c.linked_other) {
      card.appendChild(el("p", "mm-warn", "⚠ 這筆選手資料已經綁定其他會員，核准會改綁到新的會員。"));
    }

    var actions = el("div", "ck-actions");

    actions.appendChild(button("婉拒", "btn btn-ghost", function () { decide("claims", c.id, false, c.player); }));
    actions.appendChild(button("核准", "btn btn-primary", function () { decide("claims", c.id, true, c.player); }));

    card.appendChild(actions);

    return card;
  }


  function editCard(e) {

    var card = el("div", "ck-card");
    var tags = el("div", "ck-tags");

    tags.appendChild(el("span", "ck-tag ck-tag-red", "戰隊資料修改"));
    tags.appendChild(el("span", "ck-tag-note", e.created_at || ""));
    card.appendChild(tags);
    card.appendChild(el("strong", "ck-card-title", e.team_name));
    card.appendChild(el("span", "ck-card-sub", "隊長 " + e.captain + " 提交"));

    if (e.logo_url) {

      var logos = el("div", "mm-pair");
      var oldBox = el("div", "mm-logo");
      var newBox = el("div", "mm-logo mm-new");

      oldBox.appendChild(el("span", "mm-sub", "目前隊徽"));
      oldBox.appendChild(e.old_logo ? img(e.old_logo, null, "目前隊徽") : el("span", "mm-sub", "（沒有）"));
      newBox.appendChild(el("span", "mm-sub", "新隊徽"));
      newBox.appendChild(img(e.logo_url, null, "新隊徽"));

      logos.appendChild(oldBox);
      logos.appendChild(newBox);
      card.appendChild(logos);
    }

    if (e.description) {
      card.appendChild(el("span", "mm-sub", "目前介紹"));
      card.appendChild(el("p", "mm-text", e.old_description || "（沒有）"));
      card.appendChild(el("span", "mm-sub mm-red", "修改後介紹"));
      card.appendChild(el("p", "mm-text mm-new", e.description));
    }

    var actions = el("div", "ck-actions");

    actions.appendChild(button("退回", "btn btn-ghost", function () { decide("team-edits", e.id, false, e.team_name); }));
    actions.appendChild(button("核准並上線", "btn btn-primary", function () { decide("team-edits", e.id, true, e.team_name); }));

    card.appendChild(actions);

    return card;
  }


  /* =======================================================
     會員管理
  ======================================================= */

  function isSysadmin() {
    var staff = A.staff();
    return !!staff && staff.role === "sysadmin";
  }


  function renderMembers() {

    var main = mm.main;

    if (mm.view === "integration" && isSysadmin()) {
      renderIntegration();
      return;
    }
    var listBox = el("div", "ck-list");

    clear(main);

    var count = el("span", "ck-head-count");
    main.appendChild(head("會員管理", count));

    if (isSysadmin()) {
      main.appendChild(segmented([["list", "會員名單"], ["integration", "選手資料整合"]], "list", function (view) {
        mm.view = view;
        renderMembers();
      }));
    }

    var search = el("input", "ck-search");
    search.type = "search";
    search.placeholder = "暱稱、電話或戰隊";
    search.value = mm.keyword;
    search.setAttribute("aria-label", "搜尋會員");

    search.addEventListener("input", function () {
      clearTimeout(mm.timer);
      mm.timer = setTimeout(function () {
        mm.keyword = search.value.trim();
        load();
      }, 300);
    });

    main.appendChild(el("div", "ck-search-bar")).appendChild(search);

    main.appendChild(segmented([["all", "全部"], ["new", "本月新加入"], ["off", "已停用"]], mm.filter, function (f) {
      mm.filter = f;
      renderMembers();
    }));

    main.appendChild(listBox);

    function load() {

      api("GET", "/list?filter=" + mm.filter + "&q=" + encodeURIComponent(mm.keyword))
        .then(function (response) {

          count.textContent = "共 " + response.total + " 位會員";
          clear(listBox);

          if (!(response.data || []).length) {
            listBox.appendChild(el("p", "empty", "找不到會員。"));
          }

          (response.data || []).forEach(function (m) {

            var row = button("", "ck-entry-row on mm-row" + (m.status !== "active" ? " mm-off" : ""), function () {
              openDetail(m.id);
            });

            row.appendChild(m.avatar_url ? img(m.avatar_url, "mm-avatar") : el("span", "mm-avatar mm-avatar-empty", "◎"));

            var info = el("span", "ck-name");
            info.appendChild(el("strong", null, m.nickname + (m.status !== "active" ? "（已停用）" : "")));
            info.appendChild(el("small", null, (m.team_name || "未加入戰隊") + "・" + (m.phone || "")));

            row.appendChild(info);

            var games = el("span", "mm-games");
            games.appendChild(el("strong", null, String(m.games)));
            games.appendChild(el("small", null, "參賽"));
            row.appendChild(games);

            listBox.appendChild(row);
          });
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }

    load();
  }


  var sheetNode = null;

  function closeSheet() {
    if (sheetNode && sheetNode.parentNode) {
      sheetNode.parentNode.removeChild(sheetNode);
    }
    sheetNode = null;
    document.body.classList.remove("panel-open");
  }


  function openDetail(id) {

    api("GET", "/" + id).then(function (response) {

      var m = response.data;

      closeSheet();

      var panel = el("div", "panel");
      var backdrop = el("div", "panel-backdrop");
      var sheet = el("div", "panel-sheet");
      var top = el("div", "panel-head");

      top.appendChild(el("h2", null, m.nickname || "（還沒填資料）"));
      top.appendChild(button("×", "icon-button", closeSheet));

      var body = el("div", "panel-body mm-detail");

      var who = el("div", "mm-who");
      who.appendChild(m.avatar_url ? img(m.avatar_url, "mm-avatar mm-avatar-big") : el("span", "mm-avatar mm-avatar-big mm-avatar-empty", "◎"));

      var whoText = el("div");
      whoText.appendChild(el("strong", null, "LINE：" + (m.line_name || "")));
      whoText.appendChild(el("span", "mm-sub", "會員編號 " + m.erp_member_id + "・" + (m.joined_at ? m.joined_at.slice(0, 10) + " 加入" : "還沒完成註冊")));
      who.appendChild(whoText);
      body.appendChild(who);

      var info = el("div", "mm-info");

      [
        ["手機", m.phone || "—"],
        ["主要戰隊", m.primary_team || "—"],
        ["戰隊暱稱", m.players.length ? m.players.map(function (p) { return (p.team_name || "未加入戰隊") + "・" + p.player_name; }).join("、") : (m.pending_claims ? "認領審核中 " + m.pending_claims + " 筆" : "—")],
        ["最後登入", m.last_login_at || "—"],
        ["狀態", m.status === "active" ? "使用中" : "已停用"]
      ].forEach(function (pair) {
        var line = el("div", "mm-line");
        line.appendChild(el("span", "mm-sub", pair[0]));
        line.appendChild(el("strong", null, pair[1]));
        info.appendChild(line);
      });

      body.appendChild(info);

      var stats = el("div", "ck-stats");

      [["參賽次數", m.games], ["上位次數", m.wins], ["報名中", m.pending]].forEach(function (s) {
        var box = el("div", "ck-stat");
        box.appendChild(el("strong", null, String(s[1])));
        box.appendChild(el("span", null, s[0]));
        stats.appendChild(box);
      });

      body.appendChild(stats);

      /* 戰隊與隊長 */
      if (m.teams.length) {

        body.appendChild(el("span", "field-label", "所屬戰隊"));

        m.teams.forEach(function (t) {

          var line = el("div", "mm-team");

          line.appendChild(el("strong", "mm-grow", t.team_name + (t.status === "pending" ? "（等隊長核准）" : "")));

          /* 隊內暱稱：系統管理員可以改（隊長不能改） */
          if (response.can_link) {

            var teamNick = el("input", "mm-input mm-team-nick");

            teamNick.value = t.nickname || "";
            teamNick.placeholder = "隊內暱稱";
            teamNick.setAttribute("aria-label", t.team_name + "的隊內暱稱");

            teamNick.addEventListener("change", function () {
              api("POST", "/" + m.id + "/teams/" + t.id + "/nickname", { nickname: teamNick.value })
                .then(function () { toast("已更新隊內暱稱。", "success"); })
                .catch(function (error) { toast(errorText(error), "error"); });
            });

            line.appendChild(teamNick);
          } else if (t.nickname) {
            line.appendChild(el("span", "mm-sub", "隊內暱稱：" + t.nickname));
          }

          if (Number(t.is_captain) === 1) {
            line.appendChild(el("span", "ck-tag ck-tag-red", "隊長"));
          }

          line.appendChild(button(Number(t.is_captain) === 1 ? "取消隊長" : "設為隊長", "btn btn-ghost btn-small", function () {

            var unset = Number(t.is_captain) === 1;

            if (!window.confirm(unset ? "取消「" + m.nickname + "」的隊長身分？" : "把「" + m.nickname + "」設為「" + t.team_name + "」的隊長？原本的隊長會被取代。")) {
              return;
            }

            api("POST", "/" + m.id + "/captain", { team_id: t.id, unset: unset })
              .then(function () {
                toast(unset ? "已取消隊長。" : "已設為隊長。", "success");
                openDetail(m.id);
              })
              .catch(function (error) {
                toast(errorText(error), "error");
              });
          }));

          body.appendChild(line);
        });
      }

      /* 系統管理員：戰隊暱稱、幫他認領選手資料 */
      if (response.can_link) {
        body.appendChild(identityEditor(m));
        body.appendChild(recordsEditor(m));
      }

      body.appendChild(el("p", "mm-ok", "✓ 已同步到 ERP，店員結帳時可以用暱稱或電話末三碼找到這位會員"));

      var foot = el("div", "panel-foot");
      var active = m.status === "active";

      foot.appendChild(button(active ? "停用這個帳號" : "重新啟用", active ? "btn btn-danger btn-block" : "btn btn-primary btn-block", function () {

        if (active && !window.confirm("停用「" + m.nickname + "」？停用後不能登入和報名，紀錄會保留。")) {
          return;
        }

        api("POST", "/" + m.id + "/status", { status: active ? "disabled" : "active" })
          .then(function () {
            toast(active ? "已停用。" : "已重新啟用。", "success");
            closeSheet();
            renderMembers();
          })
          .catch(function (error) {
            toast(errorText(error), "error");
          });
      }));

      sheet.appendChild(top);
      sheet.appendChild(body);
      sheet.appendChild(foot);

      backdrop.addEventListener("click", closeSheet);

      panel.appendChild(backdrop);
      panel.appendChild(sheet);

      document.body.appendChild(panel);
      document.body.classList.add("panel-open");

      sheetNode = panel;
    }).catch(function (error) {
      toast(errorText(error), "error");
    });
  }


  /* =======================================================
     系統管理員：會員的戰隊暱稱、幫會員認領選手資料
  ======================================================= */

  function identityEditor(m) {

    var box = el("div", "mm-identities");

    box.appendChild(el("span", "field-label", "選手資料（每位會員保留一筆主要的，多的請合併）"));

    m.players.forEach(function (p) {

      var line = el("div", "mm-team");
      var name = el("input", "mm-input");

      name.value = p.player_name;
      name.setAttribute("aria-label", (p.team_name || "未加入戰隊") + "的暱稱");

      line.appendChild(el("span", "mm-team-name", p.team_name || "未加入戰隊"));
      line.appendChild(name);
      line.appendChild(el("span", "mm-sub", "上位 " + p.upper_count));

      line.appendChild(button("改名", "btn btn-ghost btn-small", function () {
        api("POST", "/" + m.id + "/players/" + p.id + "/nickname", { nickname: name.value })
          .then(function () { toast("已更新暱稱。", "success"); openDetail(m.id); })
          .catch(function (error) { toast(errorText(error), "error"); });
      }));

      /* 同一個人的兩筆資料：合併到另一筆 */
      if (m.players.length > 1) {

        var into = el("select", "mm-input mm-merge");
        var first = el("option", null, "合併到…");

        first.value = "";
        into.appendChild(first);

        m.players.forEach(function (other) {
          if (other.id !== p.id) {
            var option = el("option", null, (other.team_name || "未加入戰隊") + "・" + other.player_name);
            option.value = String(other.id);
            into.appendChild(option);
          }
        });

        into.setAttribute("aria-label", "把「" + p.player_name + "」合併到另一筆");

        into.addEventListener("change", function () {

          if (!into.value) {
            return;
          }

          var label = into.options[into.selectedIndex].text;

          if (!window.confirm("把「" + p.player_name + "」的參賽和上位紀錄合併到「" + label + "」，然後刪除「" + p.player_name + "」這筆資料？\n上位紀錄會保留當時的參賽名稱。")) {
            into.value = "";
            return;
          }

          api("POST", "/" + m.id + "/players/merge", { from_player_id: p.id, into_player_id: Number(into.value) })
            .then(function () { toast("已合併。", "success"); openDetail(m.id); })
            .catch(function (error) { toast(errorText(error), "error"); });
        });

        line.appendChild(into);
      }

      line.appendChild(button("解除", "btn btn-ghost btn-small", function () {
        if (!window.confirm("把「" + p.player_name + "」這筆選手資料從會員身上解除？上位紀錄會跟著移出。")) {
          return;
        }
        api("POST", "/" + m.id + "/players/unlink", { player_id: p.id })
          .then(function () { toast("已解除。", "success"); openDetail(m.id); })
          .catch(function (error) { toast(errorText(error), "error"); });
      }));

      box.appendChild(line);
    });

    /* 主要暱稱與戰隊：排行榜顯示這個 */
    var mainBox = el("div", "mm-add-row");
    var teamSelect = el("select", "mm-input");
    var nick = el("input", "mm-input");
    var noTeam = el("option", null, "未加入戰隊");

    noTeam.value = "";
    teamSelect.appendChild(noTeam);

    nick.placeholder = "主要暱稱";
    nick.value = m.nickname || "";
    teamSelect.setAttribute("aria-label", "主要戰隊");
    nick.setAttribute("aria-label", "主要暱稱");

    fetch("/api/teams").then(function (r) { return r.json(); }).then(function (res) {
      (res.data || []).forEach(function (t) {
        var option = el("option", null, t.team_name);
        option.value = String(t.id);
        option.selected = t.team_name === m.primary_team;
        teamSelect.appendChild(option);
      });
    });

    mainBox.appendChild(nick);
    mainBox.appendChild(teamSelect);
    mainBox.appendChild(button("儲存", "btn btn-gold btn-small", function () {
      api("POST", "/" + m.id + "/players/main", { nickname: nick.value, team_id: teamSelect.value || null })
        .then(function () { toast("已更新主要暱稱和戰隊，排行榜會跟著改。", "success"); openDetail(m.id); })
        .catch(function (error) { toast(errorText(error), "error"); });
    }));

    box.insertBefore(mainBox, box.firstChild);
    box.insertBefore(el("span", "field-label", "主要暱稱與戰隊（排行榜顯示這個）"), box.firstChild);

    /* 幫他認領舊的選手資料 */
    var search = el("input", "mm-input");
    var results = el("div", "mm-results");
    var timer = null;

    search.type = "search";
    search.placeholder = "搜尋舊的選手資料，幫他認領";
    search.setAttribute("aria-label", "搜尋選手資料");

    search.addEventListener("input", function () {

      clearTimeout(timer);

      timer = setTimeout(function () {

        if (!search.value.trim()) {
          clear(results);
          return;
        }

        api("GET", "/integration?q=" + encodeURIComponent(search.value.trim()))
          .then(function (res) {

            clear(results);

            (res.data || []).slice(0, 10).forEach(function (p) {

              var line = el("div", "mm-team");

              line.appendChild(el("strong", "mm-grow", p.player_name + "・" + (p.team_name || "未加入戰隊")));
              line.appendChild(el("span", "mm-sub", "上位 " + p.upper_count));
              line.appendChild(button("連到這位會員", "btn btn-primary btn-small", function () {
                api("POST", "/" + m.id + "/players/link", { player_id: p.id })
                  .then(function () { toast("已認領：" + p.player_name, "success"); openDetail(m.id); })
                  .catch(function (error) { toast(errorText(error), "error"); });
              }));

              results.appendChild(line);
            });

            if (!results.children.length) {
              results.appendChild(el("p", "mm-sub", "找不到還沒連到會員的選手資料。"));
            }
          });
      }, 300);
    });

    box.appendChild(el("span", "field-label", "幫他認領選手資料（不用審核）"));
    box.appendChild(search);
    box.appendChild(results);

    return box;
  }


  /* =======================================================
     系統管理員：手動補登參賽紀錄、上位紀錄
  ======================================================= */

  function recordsEditor(m) {

    var box = el("div", "mm-identities mm-records");
    var gamesList = el("div", "mm-results");
    var placeList = el("div", "mm-results");

    function miniInput(type, placeholder, label) {
      var node = el("input", "mm-input");
      node.type = type;
      node.placeholder = placeholder;
      node.setAttribute("aria-label", label || placeholder);
      return node;
    }

    function today() {
      var d = new Date(Date.now() + 8 * 3600000);
      return d.toISOString().slice(0, 10);
    }

    function draw(res) {

      clear(gamesList);
      clear(placeList);

      (res.placements || []).forEach(function (p) {

        var line = el("div", "mm-team");
        var place = { 1: "冠軍", 2: "亞軍", 3: "季軍" }[p.placement] || "第 " + p.placement + " 名";

        line.appendChild(el("span", "mm-grow", p.event_date.replace(/-/g, "/") + "　" + p.event_name + "　" + p.participant_count + " 人・" + place +
          (p.entry_name ? "・以「" + p.entry_name + "」參賽" : "")));
        line.appendChild(el("span", "ck-tag " + (p.source === "manual" ? "ck-tag-gold" : "ck-tag-navy"), p.source === "manual" ? "補登" : "報到系統"));

        if (p.source === "manual") {
          line.appendChild(button("刪除", "btn btn-ghost btn-small", function () {
            if (!window.confirm("刪除這筆補登的上位紀錄？")) {
              return;
            }
            api("DELETE", "/" + m.id + "/placements/" + p.id).then(draw).catch(function (error) { toast(errorText(error), "error"); });
          }));
        }

        placeList.appendChild(line);
      });

      if (!(res.placements || []).length) {
        placeList.appendChild(el("p", "mm-sub", "還沒有上位紀錄。"));
      }

      (res.games || []).forEach(function (g) {

        var line = el("div", "mm-team");

        line.appendChild(el("span", "mm-grow", g.event_date.replace(/-/g, "/") + "　" + g.event_name +
          (g.participant_count ? "　" + g.participant_count + " 人" : "") + (g.entry_name ? "・以「" + g.entry_name + "」參賽" : "")));
        line.appendChild(el("span", "ck-tag " + (g.source === "manual" ? "ck-tag-gold" : "ck-tag-navy"), g.source === "manual" ? "補登" : "報到系統"));

        if (g.source === "manual") {
          line.appendChild(button("刪除", "btn btn-ghost btn-small", function () {
            if (!window.confirm("刪除這筆補登的參賽紀錄？")) {
              return;
            }
            api("DELETE", "/" + m.id + "/games/" + g.id).then(draw).catch(function (error) { toast(errorText(error), "error"); });
          }));
        }

        gamesList.appendChild(line);
      });

      if (!(res.games || []).length) {
        gamesList.appendChild(el("p", "mm-sub", "還沒有參賽紀錄。"));
      }
    }

    /* 補登上位紀錄 */
    var pDate = miniInput("date", "日期");
    var pName = miniInput("text", "比賽名稱");
    var pTotal = miniInput("number", "人數", "參賽人數");
    var pRank = miniInput("number", "第幾名", "名次");
    var pEntry = miniInput("text", "參賽名稱（選填）");
    var pConfigs = miniInput("text", "配置（選填，多個用、分開）");

    pDate.value = today();
    pEntry.value = m.nickname || "";

    var pRow1 = el("div", "mm-add-row");
    var pRow2 = el("div", "mm-add-row");
    var pRow3 = el("div", "mm-add-row");

    pRow1.appendChild(pDate);
    pRow1.appendChild(pName);
    pRow2.appendChild(pTotal);
    pRow2.appendChild(pRank);
    pRow2.appendChild(pEntry);
    pRow3.appendChild(pConfigs);
    pRow3.appendChild(button("＋ 補登上位", "btn btn-gold btn-small", function () {
      api("POST", "/" + m.id + "/placements", {
        event_date: pDate.value,
        event_name: pName.value,
        participant_count: pTotal.value,
        placement: pRank.value,
        entry_name: pEntry.value,
        configs: pConfigs.value ? pConfigs.value.split(/[、,，]/) : []
      })
        .then(function (res) {
          toast("已補登上位紀錄（也同時補了一筆參賽紀錄）。", "success");
          pName.value = "";
          pTotal.value = "";
          pRank.value = "";
          pConfigs.value = "";
          draw(res);
        })
        .catch(function (error) { toast(errorText(error), "error"); });
    }));

    /* 補登參賽紀錄 */
    var gDate = miniInput("date", "日期");
    var gName = miniInput("text", "比賽名稱");
    var gTotal = miniInput("number", "人數（選填）", "參賽人數");
    var gEntry = miniInput("text", "參賽名稱（選填）");

    gDate.value = today();
    gEntry.value = m.nickname || "";

    var gRow1 = el("div", "mm-add-row");
    var gRow2 = el("div", "mm-add-row");

    gRow1.appendChild(gDate);
    gRow1.appendChild(gName);
    gRow2.appendChild(gTotal);
    gRow2.appendChild(gEntry);
    gRow2.appendChild(button("＋ 補登參賽", "btn btn-gold btn-small", function () {
      api("POST", "/" + m.id + "/games", {
        event_date: gDate.value,
        event_name: gName.value,
        participant_count: gTotal.value,
        entry_name: gEntry.value
      })
        .then(function (res) {
          toast("已補登參賽紀錄。", "success");
          gName.value = "";
          gTotal.value = "";
          draw(res);
        })
        .catch(function (error) { toast(errorText(error), "error"); });
    }));

    box.appendChild(el("span", "field-label", "上位紀錄（補登的可以刪除；報到系統的請用解除封存）"));
    box.appendChild(placeList);
    box.appendChild(pRow1);
    box.appendChild(pRow2);
    box.appendChild(pRow3);
    box.appendChild(el("span", "field-label", "參賽紀錄"));
    box.appendChild(gamesList);
    box.appendChild(gRow1);
    box.appendChild(gRow2);

    api("GET", "/" + m.id + "/records").then(draw).catch(function () {});

    return box;
  }


  /* 選手資料整合：還沒連到會員的選手資料，依上位次數排序 */
  function renderIntegration() {

    var main = mm.main;
    var list = el("div", "ck-list");
    var progress = el("div", "mm-progress");

    clear(main);
    main.appendChild(head("會員管理"));
    main.appendChild(segmented([["list", "會員名單"], ["integration", "選手資料整合"]], "integration", function (view) {
      mm.view = view;
      renderMembers();
    }));

    main.appendChild(progress);

    /* 一位會員有多筆選手資料的，可以在這裡合併 */
    var multiBox = el("div", "mm-multi");
    main.appendChild(multiBox);

    api("GET", "/multi").then(function (res) {

      var list = res.data || [];

      if (!list.length) {
        return;
      }

      var details = el("details", "mm-multi-box");
      details.appendChild(el("summary", null, "有多筆選手資料的會員（" + list.length + " 位）"));

      list.forEach(function (m) {

        var row = el("div", "mm-history");
        var info = el("div", "mm-grow");

        info.appendChild(el("strong", null, m.member));
        info.appendChild(el("span", "mm-sub", m.players.map(function (p) {
          return (p.team_name || "未加入戰隊") + "・" + p.player_name + "（參賽 " + p.games + "・上位 " + p.upper_count + "）";
        }).join("、")));

        row.appendChild(info);
        row.appendChild(button("整理", "btn btn-gold btn-small", function () { openDetail(m.user_id); }));
        details.appendChild(row);
      });

      multiBox.appendChild(details);
    }).catch(function () {});

    var search = el("input", "ck-search");
    search.type = "search";
    search.placeholder = "搜尋選手名稱或戰隊";
    search.setAttribute("aria-label", "搜尋選手資料");

    var timer = null;

    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });

    main.appendChild(el("div", "ck-search-bar")).appendChild(search);
    main.appendChild(el("p", "mm-sub mm-hint", "每天處理一點就好。按建議的會員就能直接連過去；建議不對，可以用「找其他會員」搜尋。"));
    main.appendChild(list);

    function link(p, memberId, name) {
      api("POST", "/" + memberId + "/players/link", { player_id: p.id })
        .then(function () {
          toast("已連結：" + p.player_name + " → " + name, "success");
          load();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }

    function load() {

      api("GET", "/integration?q=" + encodeURIComponent(search.value.trim()))
        .then(function (res) {

          clear(progress);

          var pct = res.total ? Math.round(res.linked / res.total * 100) : 0;
          var bar = el("div", "mm-bar");
          var fill = el("span");

          fill.style.width = pct + "%";
          bar.appendChild(fill);

          progress.appendChild(el("strong", null, "已整合 " + res.linked + " / " + res.total + " 筆（" + pct + "%）"));
          progress.appendChild(bar);

          clear(list);

          if (!(res.data || []).length) {
            list.appendChild(el("p", "empty", search.value.trim() ? "找不到符合的選手資料。" : "全部都整合完成了！"));
          }

          (res.data || []).forEach(function (p) {

            var card = el("div", "mm-history mm-int");
            var info = el("div", "mm-grow");

            info.appendChild(el("strong", null, p.player_name));
            info.appendChild(el("span", "mm-sub", (p.team_name || "未加入戰隊") + "・參賽 " + (p.games || 0) + " 場・上位 " + p.upper_count + " 次"));
            card.appendChild(info);

            var actions = el("div", "mm-int-actions");

            (p.suggestions || []).forEach(function (s) {
              actions.appendChild(button("→ " + s.nickname + (s.team_name ? "（" + s.team_name + "）" : ""), "btn btn-gold btn-small", function () {
                link(p, s.id, s.nickname);
              }));
            });

            actions.appendChild(button("找其他會員", "btn btn-ghost btn-small", function () {

              var q = window.prompt("輸入會員暱稱或電話末三碼");

              if (!q) {
                return;
              }

              api("GET", "/list?q=" + encodeURIComponent(q))
                .then(function (r) {

                  var found = (r.data || []).slice(0, 8);

                  if (!found.length) {
                    toast("找不到會員。", "error");
                    return;
                  }

                  var text = found.map(function (m, i) { return (i + 1) + ". " + m.nickname + (m.team_name ? "（" + m.team_name + "）" : ""); }).join("\n");
                  var pick = Number(window.prompt("要連到哪一位？輸入編號：\n" + text, "1"));

                  if (pick >= 1 && pick <= found.length) {
                    link(p, found[pick - 1].id, found[pick - 1].nickname);
                  }
                });
            }));

            card.appendChild(actions);
            list.appendChild(card);
          });
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }

    load();
  }


  window.OurSpaceMembers = {
    tabs: ["review", "members"],
    render: render,
    stop: stop
  };

})();
