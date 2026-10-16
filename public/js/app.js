/* =========================================================
   OURSPACE / 窩室官網（夜祭版，手機優先）
   頁面：首頁、賽事名單、報名名單、陀螺爭霸、陀螺戰隊、最新消息、關於我們
         戰隊聯賽（只有登入後台的系統管理員看得到）
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var NEWS_CATEGORIES = { news: "消息", event: "活動", battle: "對戰", store: "商店" };
  var NEWS_COLORS = { news: "#C9BFA8", event: "#E9B95A", battle: "#E9A3A0", store: "#8FB4E8" };
  var MATCH_FORMATS = { solo: "個人賽", duo: "雙人賽", trio: "三人賽", team: "戰隊賽" };
  var MATCH_STATUS = {
    scheduled: ["未開賽", "soon"],
    live: ["比賽中", "live"],
    paused: ["暫停", "soon"],
    finished: ["已結束", "done"],
    cancelled: ["取消", "done"]
  };

  var ERRORS = {
    RATE_LIMITED: "報名太頻繁了，請過幾分鐘再試。",
    EVENT_FULL: "名額不夠了",
    SIGNUP_CLOSED: "報名已截止或已結束",
    INVALID_NAME: "參賽名稱不可空白、最多 50 字，且不能包含 < >。",
    INVALID_PHONE: "電話格式不正確。",
    TOO_MANY_NAMES: "一次最多幫 10 位報名。",
    REQUIRED: "請填寫參賽名稱。"
  };

  var state = {
    site: null,
    events: null,
    today: "",
    staff: null,
    leagueTimer: null,
    carouselTimer: null,
    selected: [],
    rosterId: null,
    newsCat: "all"
  };

  var app = document.getElementById("app");


  /* =======================================================
     小工具
  ======================================================= */

  function h(tag, attrs, children) {

    var node = document.createElement(tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {

        var value = attrs[key];

        if (value === null || value === undefined || value === false) {
          return;
        }

        if (key === "class") {
          node.className = value;
        } else if (key === "text") {
          node.textContent = value;
        } else if (key === "style") {
          node.setAttribute("style", value);
        } else if (key.indexOf("on") === 0 && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) {
          node.setAttribute(key, "");
        } else {
          node.setAttribute(key, String(value));
        }
      });
    }

    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) {
        return;
      }
      node.appendChild(typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child);
    });

    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function api(path, options) {

    return fetch(path, options || {})
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || data.success === false) {
            var error = new Error(data.error || "HTTP_" + response.status);
            error.code = data.error;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
  }

  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  var toastTimer = null;

  function toast(message, type) {

    var node = document.getElementById("toast");

    node.textContent = message;
    node.className = "toast" + (type ? " toast-" + type : "");
    node.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.hidden = true;
    }, 3600);
  }

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? "0" + n : n;
  }

  function localToday() {
    var d = new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function dateLabel(dateText, timeText) {

    var parts = String(dateText || "").slice(0, 10).split("-");

    if (parts.length !== 3) {
      return dateText || "";
    }

    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var week = "日一二三四五六".charAt(date.getDay());

    return Number(parts[1]) + "/" + Number(parts[2]) + "（" + week + "）" + (timeText ? " " + timeText : "");
  }

  function sectionTitle(text, link) {
    return h("div", { class: "section-head" }, [
      h("h2", { text: text }),
      link || null
    ]);
  }

  function pageTitle(text, sub) {
    return h("div", { class: "page-title" }, [
      h("span", { text: sub }),
      h("h1", { text: text })
    ]);
  }

  function stateText(text, type) {
    return h("p", { class: "state" + (type ? " state-" + type : ""), text: text });
  }

  function placeStyle(label) {

    if (/冠軍|第\s*1\s*名/.test(label)) {
      return "gold";
    }

    if (/亞軍|第\s*2\s*名/.test(label)) {
      return "silver";
    }

    if (/季軍|殿軍|第\s*3\s*名/.test(label)) {
      return "bronze";
    }

    return "plain";
  }

  function placeName(n) {
    return { 1: "冠軍", 2: "亞軍", 3: "季軍" }[n] || "第 " + n + " 名";
  }


  /* =======================================================
     共用資料
  ======================================================= */

  function loadSite() {

    if (state.site) {
      return Promise.resolve(state.site);
    }

    return api("/api/checkin/site")
      .then(function (response) {
        state.site = response.data || {};
        return state.site;
      })
      .catch(function () {
        state.site = {};
        return state.site;
      });
  }

  function loadEvents(force) {

    if (state.events && !force) {
      return Promise.resolve(state.events);
    }

    return api("/api/checkin/events" + (force ? "?_=" + Date.now() : ""))
      .then(function (response) {
        state.events = response.data || [];
        state.today = response.today || localToday();
        return state.events;
      });
  }

  function loadStaff() {

    return api("/api/auth/me")
      .then(function (response) {
        state.staff = response.staff || null;
      })
      .catch(function () {
        state.staff = null;
      });
  }

  function isSysadmin() {
    return !!state.staff && state.staff.role === "sysadmin";
  }


  /* =======================================================
     選單 / 頁尾
  ======================================================= */

  var menu = document.getElementById("siteMenu");
  var menuButton = document.getElementById("menuButton");

  function openMenu() {
    document.body.classList.add("menu-open");
    menuButton.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    document.body.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  menuButton.addEventListener("click", openMenu);
  document.getElementById("menuClose").addEventListener("click", closeMenu);
  document.getElementById("menuBackdrop").addEventListener("click", closeMenu);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  function renderMenu() {

    var links = document.getElementById("menuLinks");
    var items = [
      ["events", "賽事名單"],
      ["ranking", "陀螺爭霸"],
      ["teams", "陀螺戰隊"],
      ["news", "最新消息"],
      ["about", "關於我們"]
    ];

    if (isSysadmin()) {
      items.push(["league", "戰隊聯賽（僅管理員）"]);
    }

    clear(links);

    items.forEach(function (item) {
      links.appendChild(h("a", { class: "menu-link", href: "#" + item[0], onClick: closeMenu }, [
        item[1],
        h("span", { "aria-hidden": "true", text: "›" })
      ]));
    });
  }

  function renderFooter(site) {

    var box = document.getElementById("footerSocials");
    var socials = (site && site.socials) || {};

    clear(box);

    [["line_official", "LINE"], ["line_group", "社群"], ["instagram", "IG"]].forEach(function (item) {

      var url = socials[item[0]];

      box.appendChild(h("a", {
        class: "pill pill-paper" + (url ? "" : " is-disabled"),
        href: url || null,
        target: url ? "_blank" : null,
        rel: url ? "noopener" : null,
        "aria-disabled": url ? null : "true",
        text: item[1]
      }));
    });
  }


  /* =======================================================
     路由
  ======================================================= */

  function route() {

    var hash = (window.location.hash || "#home").slice(1);
    var parts = hash.split("/");
    var page = parts[0] || "home";
    var id = parts[1] ? Number(parts[1]) || null : null;

    clearInterval(state.leagueTimer);
    clearInterval(state.carouselTimer);
    closeMenu();

    clear(app);
    app.appendChild(stateText("載入中…"));
    window.scrollTo(0, 0);

    var pages = {
      home: renderHome,
      events: renderEvents,
      roster: renderRoster,
      ranking: renderRanking,
      teams: renderTeams,
      news: renderNews,
      about: renderAbout,
      league: renderLeague
    };

    (pages[page] || renderHome)(id);

    var titles = {
      events: "賽事名單",
      roster: "報名名單",
      ranking: "陀螺爭霸",
      teams: "陀螺戰隊",
      news: "最新消息",
      about: "關於我們",
      league: "戰隊聯賽"
    };

    document.title = titles[page] ? titles[page] + "｜窩室 OURSPACE" : "窩室 OURSPACE｜戰鬥陀螺對戰空間";
  }


  window.addEventListener("hashchange", route);


  /* =======================================================
     首頁
  ======================================================= */

  function renderHome() {

    clear(app);

    /* ---------- 主視覺 ---------- */

    var hero = h("section", { class: "hero" }, [
      h("span", { class: "hero-sun", "aria-hidden": "true" }),
      h("img", { class: "hero-logo", src: "/images/ourspace-logo.jpg", alt: "窩室熊與戰鬥陀螺主視覺", width: "250", height: "250" }),
      h("h1", { class: "hero-title" }, [
        "天天",
        h("span", { class: "hero-small", text: "（基本上）" }),
        "都有比賽的窩室",
        h("span", { class: "gold", text: "最暖心" })
      ]),
      h("div", { class: "hero-actions" }, [
        h("a", { class: "pill pill-red pill-big", href: "#events", text: "賽事報名" }),
        h("a", { class: "pill pill-outline pill-big", href: "#ranking" }, [h("span", { class: "spread3", text: "排行榜" })])
      ])
    ]);

    app.appendChild(hero);

    /* ---------- 快速入口 ---------- */

    var quick = h("nav", { class: "quick", "aria-label": "快速入口" });

    [["events", "名", "名單", "q-red"], ["ranking", "霸", "爭霸", "q-gold"], ["teams", "隊", "戰隊", "q-pink"], ["news", "訊", "消息", "q-paper"]].forEach(function (item) {
      quick.appendChild(h("a", { class: "quick-item", href: "#" + item[0] }, [
        h("span", { class: "quick-mark " + item[3], text: item[1] }),
        h("span", { text: item[2] })
      ]));
    });

    app.appendChild(quick);

    /* ---------- 下場比賽 ---------- */

    var nextBox = h("section", { class: "section" }, [stateText("載入中…")]);
    app.appendChild(nextBox);

    loadEvents(true)
      .then(function (events) {

        var next = null;

        events.forEach(function (event) {
          if (!next && event.event_type === "big" && !event.archived_at) {
            next = event;
          }
        });

        clear(nextBox);

        var card = h("div", { class: "paper-card" }, [h("span", { class: "kicker red", text: "下場比賽" })]);

        if (!next) {
          card.appendChild(h("div", { class: "coming" }, [
            h("strong", { text: "敬請期待" }),
            h("span", { text: "下場比賽公布後會顯示在這裡" })
          ]));
        } else {

          card.appendChild(h("strong", { class: "paper-title", text: next.title }));
          card.appendChild(h("div", { class: "paper-lines" }, [
            h("span", { text: "日期　" + dateLabel(next.event_date, next.start_time) }),
            next.note ? h("span", { text: "地點　" + next.note }) : null,
            h("span", { text: "報名　" + next.total + (next.capacity ? " / " + next.capacity : "") + " 人" })
          ]));
          card.appendChild(h("a", { class: "pill pill-red pill-block", href: "#events", onClick: function () { state.selected = [next.id]; }, text: "立即報名" }));
        }

        nextBox.appendChild(card);
      })
      .catch(function () {
        clear(nextBox);
      });

    /* ---------- 恭喜上位 ---------- */

    var winBox = h("section", { class: "section" });
    app.appendChild(winBox);

    api("/api/checkin/highlights")
      .then(function (response) {

        var list = (response.data || []).slice(0, 3);

        if (!list.length) {
          return;
        }

        winBox.appendChild(sectionTitle("恭喜上位", h("a", { class: "more", href: "#ranking", text: "排行榜 ›" })));

        list.forEach(function (row) {
          winBox.appendChild(h("div", { class: "night-card win-row" }, [
            h("span", { class: "medal medal-" + placeStyle(row.rank_label), text: row.rank_label }),
            h("div", { class: "grow" }, [
              h("strong", { text: row.nickname }),
              h("span", { class: "muted", text: row.title + "・" + dateLabel(row.event_date) + (row.team_name ? "・" + row.team_name : "") })
            ])
          ]));
        });
      })
      .catch(function () {});

    /* ---------- 輪播照片 ---------- */

    var galleryBox = h("section", { class: "section" });
    app.appendChild(galleryBox);

    api("/api/news/images")
      .then(function (response) {
        var list = response.data || [];
        if (list.length) {
          galleryBox.appendChild(carousel(list));
        }
      })
      .catch(function () {});

    /* ---------- 最新公告 ---------- */

    var newsBox = h("section", { class: "section" });
    app.appendChild(newsBox);

    api("/api/news")
      .then(function (response) {

        var list = (response.data || []).slice(0, 3);

        if (!list.length) {
          return;
        }

        var box = h("div", { class: "red-box" }, [sectionTitle("最新公告", h("a", { class: "more more-light", href: "#news", text: "全部 ›" }))]);

        list.forEach(function (item) {
          box.appendChild(newsRow(item, true));
        });

        newsBox.appendChild(box);
      })
      .catch(function () {});

    /* ---------- 來店資訊 ---------- */

    var visitBox = h("section", { class: "section" });
    app.appendChild(visitBox);

    loadSite().then(function (site) {
      visitBox.appendChild(visitCard(site));
    });
  }


  function carousel(list) {

    var index = 0;
    var track = h("div", { class: "carousel-track" });
    var dots = h("div", { class: "carousel-dots" });

    list.forEach(function (item, i) {

      var slide = h(item.link_url ? "a" : "div", {
        class: "carousel-slide",
        href: item.link_url || null,
        target: item.link_url && /^https?:/.test(item.link_url) ? "_blank" : null,
        rel: item.link_url && /^https?:/.test(item.link_url) ? "noopener" : null
      }, [
        h("img", { src: item.image_url, alt: item.title || "窩室照片", loading: i ? "lazy" : null }),
        item.title ? h("span", { class: "carousel-caption" }, [
          h("strong", { text: item.title }),
          item.subtitle ? h("span", { text: item.subtitle }) : null
        ]) : null
      ]);

      track.appendChild(slide);
      dots.appendChild(h("span", { class: "dot" }));
    });

    function go(i) {

      index = (i + list.length) % list.length;
      track.style.transform = "translateX(" + (-100 * index) + "%)";

      Array.prototype.forEach.call(dots.children, function (dot, k) {
        dot.classList.toggle("active", k === index);
      });
    }

    var box = h("div", { class: "carousel" }, [
      track,
      list.length > 1 ? h("button", { class: "carousel-btn prev", type: "button", "aria-label": "上一張", onClick: function () { go(index - 1); restart(); }, text: "‹" }) : null,
      list.length > 1 ? h("button", { class: "carousel-btn next", type: "button", "aria-label": "下一張", onClick: function () { go(index + 1); restart(); }, text: "›" }) : null
    ]);

    /* 左右滑動 */
    var startX = null;

    box.addEventListener("touchstart", function (event) {
      startX = event.touches[0].clientX;
    }, { passive: true });

    box.addEventListener("touchend", function (event) {

      if (startX === null) {
        return;
      }

      var dx = event.changedTouches[0].clientX - startX;

      if (Math.abs(dx) > 40) {
        go(index + (dx < 0 ? 1 : -1));
        restart();
      }

      startX = null;
    });

    function restart() {

      clearInterval(state.carouselTimer);

      if (list.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        state.carouselTimer = setInterval(function () { go(index + 1); }, 5000);
      }
    }

    go(0);
    restart();

    return h("div", {}, [box, list.length > 1 ? dots : null]);
  }


  function visitCard(site) {

    var store = (site && site.store) || {};
    var hours = h("div", { class: "grow" }, [h("strong", { text: "營業時間" })]);

    (store.hours || []).forEach(function (row) {
      hours.appendChild(h("div", { class: "hour-row" }, [h("span", { text: row.day }), h("span", { text: row.time })]));
    });

    return h("div", { class: "line-card" }, [
      h("h2", { class: "serif", text: "來店資訊" }),
      h("div", { class: "info-row" }, [
        h("span", { class: "info-icon gold-bg", "aria-hidden": "true", text: "◷" }),
        hours
      ]),
      store.address ? h("div", { class: "info-row" }, [
        h("span", { class: "info-icon red-bg", "aria-hidden": "true", text: "⌖" }),
        h("div", { class: "grow" }, [h("strong", { text: "店面地址" }), h("div", { class: "muted", text: store.address })])
      ]) : null,
      h("a", {
        class: "pill pill-outline pill-block",
        href: store.map_url || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(store.address || "窩室")),
        target: "_blank",
        rel: "noopener",
        text: "在 Google 地圖開啟"
      })
    ]);
  }


  /* =======================================================
     賽事名單（報名）
  ======================================================= */

  function renderEvents() {

    loadEvents(true)
      .then(function (events) {
        drawEvents(events);
      })
      .catch(function () {
        clear(app);
        app.appendChild(stateText("賽事載入失敗，請重新整理頁面。", "error"));
      });
  }


  function eventStatus(event) {

    var now = state.today;
    var full = event.capacity && event.total >= event.capacity;
    var closed = event.archived_at || (event.reg_deadline && event.reg_deadline.slice(0, 10) < now);

    if (event.event_type !== "big") {
      return { key: "daily", text: "現場報名", open: false };
    }

    if (closed) {
      return { key: "closed", text: "報名截止", open: false };
    }

    if (full) {
      return { key: "full", text: "額滿", open: false };
    }

    return { key: "open", text: "報名中", open: true };
  }


  function drawEvents(events) {

    clear(app);

    app.appendChild(pageTitle("賽事名單", "EVENTS"));
    app.appendChild(h("p", { class: "lead", text: "勾選想參加的大型賽事，可以一次報名多場、幫朋友一起報。" }));

    if (!events.length) {
      app.appendChild(stateText("目前沒有今天或之後的場次。"));
      return;
    }

    /* 只保留還能報名的勾選 */
    state.selected = state.selected.filter(function (id) {
      return events.some(function (e) { return e.id === id && eventStatus(e).open; });
    });

    var list = h("section", { class: "section event-list" });

    events.forEach(function (event) {

      var st = eventStatus(event);
      var selected = state.selected.indexOf(event.id) !== -1;
      var big = event.event_type === "big";

      var card = h("div", { class: "paper-card event-card" + (selected ? " is-selected" : "") + (st.open || !big ? "" : " is-muted") });

      var top = h("div", { class: "event-top" }, [
        h("div", { class: "grow" }, [
          h("div", { class: "tags" }, [
            h("span", { class: "tag " + (big ? "tag-red" : "tag-navy"), text: big ? "大型賽事" : "日常賽" }),
            h("span", { class: "tag tag-" + st.key, text: st.text })
          ]),
          h("strong", { class: "paper-title", text: event.title }),
          h("span", { class: "paper-sub", text: dateLabel(event.event_date, event.start_time) + (event.fee ? "・報名費 $" + event.fee : "") })
        ])
      ]);

      if (st.open) {
        top.appendChild(h("button", {
          class: "check-btn" + (selected ? " on" : ""),
          type: "button",
          "aria-pressed": selected ? "true" : "false",
          "aria-label": "選擇 " + event.title,
          onClick: function () {
            if (selected) {
              state.selected = state.selected.filter(function (id) { return id !== event.id; });
            } else {
              state.selected.push(event.id);
            }
            drawEvents(events);
          }
        }, [h("span", { "aria-hidden": "true", text: "✓" })]));
      }

      card.appendChild(top);

      if (big && event.capacity) {
        card.appendChild(h("div", { class: "quota" }, [
          h("div", { class: "quota-head" }, [h("span", { text: "名額" }), h("span", { text: event.total + " / " + event.capacity + " 人" })]),
          h("div", { class: "quota-bar" }, [h("span", { style: "width: " + Math.min(100, Math.round(event.total / event.capacity * 100)) + "%" })])
        ]));
      } else {
        card.appendChild(h("span", { class: "paper-sub", text: "已報名 " + event.total + " 人" + (event.checked ? "・已報到 " + event.checked + " 人" : "") }));
      }

      card.appendChild(h("a", { class: "card-link", href: "#roster/" + event.id, text: "看報名名單 ›" }));

      list.appendChild(card);
    });

    app.appendChild(list);

    var bar = h("div", { class: "bottom-bar" }, [
      h("div", { class: "bottom-info" }, [
        h("strong", { text: "已選 " + state.selected.length + " 場" }),
        h("span", { text: "報名費現場繳交" })
      ]),
      h("button", {
        class: "pill pill-red pill-big pill-block",
        type: "button",
        disabled: !state.selected.length,
        onClick: function () { openSignup(events); },
        text: state.selected.length ? "報名" : "先勾選要報名的大型賽事"
      })
    ]);

    app.appendChild(bar);
  }


  function openSignup(events) {

    var chosen = events.filter(function (e) { return state.selected.indexOf(e.id) !== -1; });
    var nameList = h("div", { class: "name-list" });
    var phone = h("input", { type: "tel", inputmode: "tel", placeholder: "09xx-xxx-xxx（選填）", autocomplete: "tel", "aria-label": "聯絡電話" });

    function addName(value) {

      var input = h("input", { type: "text", maxlength: "50", placeholder: nameList.children.length ? "朋友的參賽名稱" : "你的參賽名稱", "aria-label": "參賽名稱" });
      input.value = value || "";

      var row = h("div", { class: "name-row" }, [
        input,
        h("button", {
          class: "x-btn",
          type: "button",
          "aria-label": "移除這位",
          onClick: function () {
            if (nameList.children.length > 1) {
              nameList.removeChild(row);
            }
          },
          text: "×"
        })
      ]);

      nameList.appendChild(row);
      input.focus();
    }

    var submit = h("button", { class: "pill pill-red pill-big pill-block", type: "button", text: "送出報名" });

    var sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "填寫報名資料" }, [
      h("div", { class: "sheet-backdrop", onClick: close }),
      h("div", { class: "sheet-body" }, [
        h("div", { class: "sheet-head" }, [
          h("div", {}, [
            h("strong", { class: "serif", text: "填寫報名資料" }),
            h("div", { class: "muted", text: "報名：" + chosen.map(function (e) { return e.title; }).join("、") })
          ]),
          h("button", { class: "round-btn round-btn-ghost", type: "button", "aria-label": "關閉", onClick: close, text: "×" })
        ]),
        h("span", { class: "label", text: "參賽名稱（可以一次幫多人報名）" }),
        nameList,
        h("button", { class: "dash-btn", type: "button", onClick: function () { addName(""); }, text: "＋ 再加一位" }),
        h("label", { class: "field" }, [
          h("span", { class: "label", text: "聯絡電話（選填）" }),
          phone,
          h("span", { class: "muted small", text: "只給店家聯絡用，不會顯示在官網。" })
        ]),
        h("p", { class: "muted small", text: "要取消報名，請透過 LINE 官方帳號或現場告訴店家。" }),
        submit
      ])
    ]);

    function close() {
      if (sheet.parentNode) {
        sheet.parentNode.removeChild(sheet);
      }
      document.body.classList.remove("sheet-open");
    }

    submit.addEventListener("click", function () {

      var names = Array.prototype.map.call(nameList.querySelectorAll("input"), function (input) {
        return input.value.trim();
      }).filter(Boolean);

      if (!names.length) {
        toast("請填寫參賽名稱。", "error");
        return;
      }

      submit.disabled = true;

      post("/api/checkin/register", { event_ids: state.selected, names: names, phone: phone.value.trim() })
        .then(function (response) {

          close();

          var added = 0;
          var dup = 0;

          (response.data || []).forEach(function (row) {
            added += row.added;
            dup += row.duplicates;
          });

          state.selected = [];

          toast("報名完成！共 " + added + " 筆" + (dup ? "（" + dup + " 筆已經報名過）" : "") + "。", "success");

          renderEvents();
        })
        .catch(function (error) {

          var text = ERRORS[error.code] || "報名失敗，請稍後再試。";

          if (error.data && error.data.title) {
            text = "「" + error.data.title + "」" + text + (error.code === "EVENT_FULL" ? "，只剩 " + error.data.left + " 個名額。" : "。");
          }

          toast(text, "error");
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    addName("");

    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
  }


  /* =======================================================
     報名名單
  ======================================================= */

  function renderRoster(id) {

    loadEvents(true)
      .then(function (events) {

        clear(app);

        app.appendChild(h("a", { class: "back-link", href: "#events", text: "‹ 賽事名單" }));

        if (!events.length) {
          app.appendChild(stateText("目前沒有今天或之後的場次。"));
          return;
        }

        var current = null;

        events.forEach(function (event) {
          if (event.id === id) {
            current = event;
          }
        });

        if (!current) {
          current = events[0];
        }

        var select = h("select", { class: "select", "aria-label": "選擇賽事" });

        events.forEach(function (event) {
          var option = h("option", { value: String(event.id), text: event.title + "・" + dateLabel(event.event_date) });
          option.selected = event.id === current.id;
          select.appendChild(option);
        });

        select.addEventListener("change", function () {
          window.location.hash = "#roster/" + select.value;
        });

        app.appendChild(h("div", { class: "section section-top" }, [h("label", { class: "field" }, [h("span", { class: "label", text: "選擇賽事" }), select])]));

        var body = h("div", {}, [stateText("名單載入中…")]);
        app.appendChild(body);

        return api("/api/checkin/events/" + current.id + "?_=" + Date.now()).then(function (response) {
          drawRoster(body, response.data);
        });
      })
      .catch(function () {
        clear(app);
        app.appendChild(stateText("名單載入失敗，請重新整理頁面。", "error"));
      });
  }


  function drawRoster(body, event) {

    clear(body);

    var entries = event.entries || [];
    var checked = entries.filter(function (e) { return Number(e.checked_in) === 1; });
    var big = event.event_type === "big";

    /* 已報到的依參賽號碼排前面，其餘依報名順序 */
    var ordered = checked.slice().sort(function (a, b) {
      return (a.checkin_number || 9999) - (b.checkin_number || 9999);
    }).concat(entries.filter(function (e) { return Number(e.checked_in) !== 1; }));

    var stats = big && event.capacity
      ? [["已報名", entries.length, "navy"], ["名額", event.capacity, "sand"], ["剩餘", Math.max(0, event.capacity - entries.length), "red"]]
      : [["已報名", entries.length, "navy"], ["已報到", checked.length, "red"]];

    body.appendChild(h("section", { class: "section" }, [h("div", { class: "paper-card" }, [
      h("div", { class: "tags" }, [h("span", { class: "tag " + (big ? "tag-red" : "tag-navy"), text: big ? "大型賽事" : "日常賽" })]),
      h("h1", { class: "paper-title", text: event.title }),
      h("span", { class: "paper-sub", text: dateLabel(event.event_date, event.start_time) + (event.fee ? "・報名費 $" + event.fee : "") + (event.note ? "・" + event.note : "") }),
      h("div", { class: "stats" }, stats.map(function (s) {
        return h("div", { class: "stat stat-" + s[2] }, [h("strong", { text: String(s[1]) }), h("span", { text: s[0] })]);
      })),
      big && !event.archived_at && (!event.capacity || entries.length < event.capacity) && (!event.reg_deadline || event.reg_deadline.slice(0, 10) >= state.today) ? h("a", { class: "pill pill-red pill-block", href: "#events", onClick: function () { state.selected = [event.id]; }, text: "我要報名" }) : null
    ])]));

    /* ---------- 海報 / 詳細資訊（預設收起） ---------- */

    var details = [
      ["加碼回饋", event.bonus_text],
      ["比賽規則", event.rules_text],
      ["特殊規則", event.special_text],
      ["注意事項", event.notes_text]
    ].filter(function (d) { return d[1]; });

    var prizes = (event.prizes || []).filter(function (p) { return p.prize; });

    if (event.poster_url || details.length || prizes.length) {

      var panel = h("div", { class: "fold-body", hidden: true });

      if (event.poster_url) {
        panel.appendChild(h("button", { class: "poster", type: "button", "aria-label": "放大海報", onClick: function () { showPoster(event); } }, [
          h("img", { src: event.poster_url, alt: event.title + " 海報", loading: "lazy" }),
          h("span", { class: "poster-hint", text: "點一下放大" })
        ]));
      }

      if (!event.poster_url || details.length || prizes.length) {

        var info = h("div", { class: "detail-box" });

        if (prizes.length) {
          info.appendChild(h("div", { class: "detail-row" }, [
            h("span", { text: "比賽獎品" }),
            h("div", {}, prizes.map(function (p) { return h("div", { text: p.rank_label + "：" + p.prize }); }))
          ]));
        }

        details.forEach(function (d) {
          info.appendChild(h("div", { class: "detail-row" }, [h("span", { text: d[0] }), h("div", { class: "pre", text: d[1] })]));
        });

        if (info.children.length) {
          panel.appendChild(info);
        }
      }

      var foldBtn = h("button", { class: "fold-btn", type: "button", "aria-expanded": "false" }, [
        h("span", { text: event.poster_url ? "比賽海報與詳細資訊" : "賽事詳細資訊" }),
        h("span", { class: "fold-action", text: "展開 ▾" })
      ]);

      foldBtn.addEventListener("click", function () {
        panel.hidden = !panel.hidden;
        foldBtn.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        foldBtn.lastChild.textContent = panel.hidden ? "展開 ▾" : "隱藏 ▴";
      });

      body.appendChild(h("section", { class: "section" }, [foldBtn, panel]));
    }

    /* ---------- 名單 ---------- */

    var search = h("input", { type: "search", class: "search", placeholder: "搜尋參賽名稱或戰隊", "aria-label": "搜尋參賽名稱或戰隊" });
    var list = h("div", { class: "roster-list" });

    function drawList() {

      clear(list);

      var keyword = search.value.trim().toLowerCase();

      var rows = ordered.filter(function (e) {
        return !keyword ||
          String(e.nickname).toLowerCase().indexOf(keyword) !== -1 ||
          String(e.team_name || "").toLowerCase().indexOf(keyword) !== -1;
      });

      if (!rows.length) {
        list.appendChild(stateText(entries.length ? "找不到符合的名字。" : "還沒有人報名。"));
        return;
      }

      var order = 0;

      rows.forEach(function (e) {

        var on = Number(e.checked_in) === 1;

        if (!on) {
          order = entries.indexOf(e) + 1;
        }

        list.appendChild(h("div", { class: "roster-row" + (on ? " on" : "") }, [
          h("span", { class: "num" + (on ? " on" : ""), text: on && e.checkin_number ? String(e.checkin_number) : String(order) }),
          h("span", { class: "grow" }, [
            h("strong", { text: e.nickname + (Number(e.is_judge) === 1 ? " ㊣" : "") }),
            e.team_name ? h("span", { class: "muted small", text: e.team_name }) : null
          ]),
          h("span", { class: "roster-status" + (on ? " on" : ""), text: on ? "已報到" : "待報到" })
        ]));
      });
    }

    search.addEventListener("input", drawList);

    body.appendChild(h("section", { class: "section" }, [
      search,
      h("div", { class: "list-hint" }, [
        h("span", { text: "紅色數字為參賽號碼（已報到）" }),
        h("span", { text: "共 " + entries.length + " 人" })
      ]),
      list
    ]));

    drawList();
  }


  function showPoster(event) {

    var box = h("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": event.title + " 海報" }, [
      h("button", { class: "round-btn round-btn-ghost lightbox-close", type: "button", "aria-label": "關閉海報", text: "×" }),
      h("img", { src: event.poster_url, alt: event.title + " 海報" })
    ]);

    function close() {
      if (box.parentNode) {
        box.parentNode.removeChild(box);
      }
    }

    box.addEventListener("click", close);
    document.body.appendChild(box);
  }


  /* =======================================================
     陀螺爭霸
  ======================================================= */

  function renderRanking() {

    api("/api/ranking")
      .then(function (response) {

        var list = response.data || [];

        clear(app);
        app.appendChild(pageTitle("陀螺爭霸", "TOP SPINNERS"));
        app.appendChild(h("p", { class: "lead", text: "依上位次數排名，同次數比冠軍次數。點選手看他最強的三場。" }));

        if (!list.length) {
          app.appendChild(stateText("還沒有上位紀錄。"));
          return;
        }

        var detail = h("div", { class: "section" });

        function showBest(player, holder) {

          clear(holder);
          holder.appendChild(stateText("載入中…"));

          api("/api/ranking/" + player.player_id)
            .then(function (res) {

              clear(holder);

              var box = h("div", { class: "best-box" }, [h("span", { class: "kicker gold", text: (player.nickname || player.player_name) + " 最強的三場" })]);

              (res.highlights || []).forEach(function (row) {
                box.appendChild(h("div", { class: "best-row" }, [
                  h("span", { class: "medal medal-" + placeStyle(placeName(row.placement)), text: placeName(row.placement) }),
                  h("div", { class: "grow" }, [
                    h("strong", { text: row.event_name }),
                    h("span", { class: "muted small", text: dateLabel(row.event_date) + "・" + row.participant_count + " 人參賽" })
                  ])
                ]));
              });

              holder.appendChild(box);
            })
            .catch(function () {
              clear(holder);
            });
        }

        /* 頒獎台：2 1 3 */
        var podium = h("div", { class: "podium" });

        [1, 0, 2].forEach(function (i) {

          var p = list[i];

          if (!p) {
            return;
          }

          podium.appendChild(h("button", {
            class: "podium-item podium-" + (i + 1),
            type: "button",
            onClick: function () { showBest(p, detail); }
          }, [
            avatar(p.avatar_url, 52),
            h("strong", { class: "serif", text: "第 " + (i + 1) + " 名" }),
            h("strong", { class: "podium-name", text: p.nickname || p.player_name }),
            h("span", { text: "上位 " + p.upper_count + " 次" })
          ]));
        });

        app.appendChild(h("section", { class: "section" }, [podium]));
        app.appendChild(detail);

        var rows = h("section", { class: "section rank-list" });

        list.slice(3).forEach(function (p, k) {

          var holder = h("div", { class: "rank-detail" });
          var open = false;

          var row = h("button", { class: "rank-row", type: "button", "aria-expanded": "false" }, [
            h("strong", { class: "rank-no", text: String(k + 4) }),
            avatar(p.avatar_url, 40),
            h("span", { class: "grow" }, [
              h("strong", { text: p.nickname || p.player_name }),
              h("span", { class: "muted small", text: p.team_name || "" })
            ]),
            h("span", { class: "rank-count" }, [
              h("strong", { text: String(p.upper_count) }),
              h("span", { text: "冠軍 " + (p.first_count || 0) })
            ])
          ]);

          row.addEventListener("click", function () {
            open = !open;
            row.setAttribute("aria-expanded", open ? "true" : "false");
            wrap.classList.toggle("open", open);
            if (open) {
              showBest(p, holder);
            } else {
              clear(holder);
            }
          });

          var wrap = h("div", { class: "rank-wrap" }, [row, holder]);
          rows.appendChild(wrap);
        });

        app.appendChild(rows);
      })
      .catch(function () {
        clear(app);
        app.appendChild(stateText("排行榜載入失敗，請重新整理頁面。", "error"));
      });
  }


  function avatar(url, size) {

    if (url) {
      return h("img", { class: "avatar", src: url, alt: "", width: String(size), height: String(size), style: "width: " + size + "px; height: " + size + "px", loading: "lazy" });
    }

    return h("span", { class: "avatar avatar-empty", style: "width: " + size + "px; height: " + size + "px", "aria-hidden": "true", text: "◎" });
  }


  /* =======================================================
     陀螺戰隊
  ======================================================= */

  function renderTeams() {

    api("/api/teams")
      .then(function (response) {

        var list = response.data || [];

        clear(app);
        app.appendChild(pageTitle("陀螺戰隊", "TEAMS"));
        app.appendChild(h("p", { class: "lead", text: "在窩室活躍的戰隊。點戰隊看完整介紹。" }));

        if (!list.length) {
          app.appendChild(stateText("還沒有戰隊資料。"));
          return;
        }

        var grid = h("section", { class: "section team-grid" });

        list.forEach(function (team) {

          var card = h("button", { class: "team-card", type: "button", "aria-expanded": "false" }, [
            team.team_logo_url
              ? h("img", { class: "team-logo", src: team.team_logo_url, alt: team.team_name + " 隊徽", loading: "lazy" })
              : h("span", { class: "team-logo team-logo-empty", "aria-hidden": "true", text: team.team_name.slice(0, 1) }),
            h("span", { class: "team-text" }, [
              h("strong", { class: "serif", text: team.team_name }),
              h("span", { class: "team-intro", text: team.description || "這個戰隊還沒有介紹。" })
            ])
          ]);

          card.addEventListener("click", function () {
            var open = !card.classList.contains("open");
            Array.prototype.forEach.call(grid.children, function (node) {
              node.classList.remove("open");
              node.setAttribute("aria-expanded", "false");
            });
            card.classList.toggle("open", open);
            card.setAttribute("aria-expanded", open ? "true" : "false");
          });

          grid.appendChild(card);
        });

        app.appendChild(grid);
      })
      .catch(function () {
        clear(app);
        app.appendChild(stateText("戰隊載入失敗，請重新整理頁面。", "error"));
      });
  }


  /* =======================================================
     最新消息
  ======================================================= */

  function newsRow(item, onRed) {
    return h("a", { class: "news-row" + (onRed ? " on-red" : ""), href: "#news/" + item.id }, [
      item.cover_image_url
        ? h("img", { class: "news-thumb", src: item.cover_image_url, alt: "", loading: "lazy" })
        : h("span", { class: "news-thumb news-thumb-empty", "aria-hidden": "true", text: "訊" }),
      h("span", { class: "grow" }, [
        h("span", { class: "news-meta", style: onRed ? null : "color: " + (NEWS_COLORS[item.category] || "#C9BFA8"), text: (NEWS_CATEGORIES[item.category] || "消息") + "・" + dateLabel(item.published_at) }),
        h("strong", { text: item.title })
      ])
    ]);
  }


  function renderNews(id) {

    api("/api/news")
      .then(function (response) {

        var list = response.data || [];

        clear(app);

        if (id) {

          var item = null;

          list.forEach(function (n) {
            if (n.id === id) {
              item = n;
            }
          });

          if (!item) {
            app.appendChild(h("a", { class: "back-link", href: "#news", text: "‹ 最新消息" }));
            app.appendChild(stateText("找不到這則公告。"));
            return;
          }

          drawArticle(item);
          return;
        }

        app.appendChild(pageTitle("最新消息", "NEWS"));

        var chips = h("div", { class: "chips" });
        var box = h("section", { class: "section news-list" });

        function draw() {

          clear(chips);

          [["all", "全部"]].concat(Object.keys(NEWS_CATEGORIES).map(function (k) { return [k, NEWS_CATEGORIES[k]]; })).forEach(function (c) {
            chips.appendChild(h("button", {
              class: "chip" + (state.newsCat === c[0] ? " active" : ""),
              type: "button",
              "aria-pressed": state.newsCat === c[0] ? "true" : "false",
              onClick: function () { state.newsCat = c[0]; draw(); },
              text: c[1]
            }));
          });

          clear(box);

          var shown = list.filter(function (n) { return state.newsCat === "all" || n.category === state.newsCat; });

          if (!shown.length) {
            box.appendChild(stateText("這個分類還沒有公告。"));
          }

          shown.forEach(function (n) {
            box.appendChild(h("a", { class: "news-card", href: "#news/" + n.id }, [
              n.cover_image_url ? h("img", { src: n.cover_image_url, alt: "", loading: "lazy" }) : null,
              h("span", { class: "news-card-body" }, [
                h("span", { class: "news-meta", style: "color: " + (NEWS_COLORS[n.category] || "#C9BFA8"), text: (NEWS_CATEGORIES[n.category] || "消息") + "・" + dateLabel(n.published_at) }),
                h("strong", { text: n.title }),
                n.summary ? h("span", { class: "news-summary", text: n.summary }) : null
              ])
            ]));
          });
        }

        app.appendChild(chips);
        app.appendChild(box);
        draw();
      })
      .catch(function () {
        clear(app);
        app.appendChild(stateText("公告載入失敗，請重新整理頁面。", "error"));
      });
  }


  function drawArticle(item) {

    var link = window.location.origin + "/#news/" + item.id;

    app.appendChild(h("a", { class: "back-link", href: "#news", text: "‹ 最新消息" }));

    app.appendChild(h("article", { class: "section article" }, [
      item.cover_image_url ? h("img", { class: "article-cover", src: item.cover_image_url, alt: "" }) : null,
      h("span", { class: "news-meta", style: "color: " + (NEWS_COLORS[item.category] || "#C9BFA8"), text: (NEWS_CATEGORIES[item.category] || "消息") + "・" + dateLabel(item.published_at) }),
      h("h1", { class: "article-title", text: item.title }),
      h("div", { class: "paper-card pre article-body", text: item.content || item.summary || "" }),
      h("div", { class: "row-gap" }, [
        h("a", { class: "pill pill-paper grow", href: "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(link), target: "_blank", rel: "noopener", text: "分享到 LINE" }),
        h("button", {
          class: "pill pill-outline grow",
          type: "button",
          onClick: function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(link).then(function () { toast("已複製連結。", "success"); });
            }
          },
          text: "複製連結"
        })
      ])
    ]));

    document.title = item.title + "｜窩室 OURSPACE";
  }


  /* =======================================================
     關於我們
  ======================================================= */

  function renderAbout() {

    loadSite().then(function (site) {

      var about = site.about || {};
      var socials = site.socials || {};

      clear(app);
      app.appendChild(pageTitle("關於我們", "ABOUT OURSPACE"));

      if (about.image_url) {
        app.appendChild(h("section", { class: "section" }, [h("img", { class: "about-photo", src: about.image_url, alt: "窩室店面" })]));
      }

      app.appendChild(h("section", { class: "section" }, [
        h("div", { class: "paper-card" }, [
          h("strong", { class: "paper-title" }, ["天天", h("span", { class: "hero-small red", text: "（基本上）" }), "都有比賽的窩室"]),
          h("div", { class: "pre about-text", text: about.text || "窩室是高雄的戰鬥陀螺對戰空間，歡迎新手和老手一起來轉。" })
        ])
      ]));

      app.appendChild(h("section", { class: "section" }, [visitCard(site)]));

      var follow = h("section", { class: "section follow" }, [h("h2", { class: "serif", text: "追蹤我們" })]);

      [["line_official", "LINE 官方帳號", "pill-line"], ["line_group", "LINE 社群", "pill-paper"], ["instagram", "Instagram", "pill-paper"]].forEach(function (item) {
        if (socials[item[0]]) {
          follow.appendChild(h("a", { class: "pill pill-big pill-block " + item[2], href: socials[item[0]], target: "_blank", rel: "noopener", text: item[1] }));
        }
      });

      if (follow.children.length > 1) {
        app.appendChild(follow);
      }
    });
  }


  /* =======================================================
     戰隊聯賽（只有系統管理員）
  ======================================================= */

  function renderLeague() {

    if (!isSysadmin()) {
      clear(app);
      app.appendChild(stateText("這個頁面目前不公開。"));
      return;
    }

    var tab = "schedule";
    var day = null;

    clear(app);
    app.appendChild(pageTitle("戰隊聯賽", "TEAM BATTLE LEAGUE"));
    app.appendChild(h("p", { class: "lead", text: "這一頁目前只有系統管理員看得到。" }));

    var tabs = h("div", { class: "seg" });
    var body = h("div", {});

    app.appendChild(tabs);
    app.appendChild(body);

    function drawTabs() {
      clear(tabs);
      [["schedule", "賽程"], ["standings", "積分"]].forEach(function (t) {
        tabs.appendChild(h("button", {
          class: "seg-btn" + (tab === t[0] ? " active" : ""),
          type: "button",
          onClick: function () { tab = t[0]; drawTabs(); load(); },
          text: t[1]
        }));
      });
    }

    function load() {

      if (tab === "standings") {

        api("/api/league/standings").then(function (response) {

          clear(body);

          var table = h("div", { class: "paper-card standings" }, [
            h("div", { class: "st-row st-head" }, ["名次", "戰隊", "勝", "敗", "積分"].map(function (t) { return h("span", { text: t }); }))
          ]);

          (response.data || []).forEach(function (row, i) {
            table.appendChild(h("div", { class: "st-row" }, [
              h("strong", { class: i < 3 ? "red" : "", text: String(i + 1) }),
              h("strong", { text: row.team_name }),
              h("span", { text: String(row.wins || 0) }),
              h("span", { text: String(row.losses || 0) }),
              h("strong", { text: String(row.total_points || 0) })
            ]));
          });

          if (response.tournament) {
            body.appendChild(h("span", { class: "tag tag-outline", text: response.tournament.title }));
          }

          body.appendChild(table);
        }).catch(function () {
          clear(body);
          body.appendChild(stateText("積分載入失敗。", "error"));
        });

        return;
      }

      api("/api/league").then(function (response) {

        var matches = response.data || [];
        var days = [];

        matches.forEach(function (m) {
          var d = String(m.scheduled_at || "").slice(0, 10);
          if (d && days.indexOf(d) === -1) {
            days.push(d);
          }
        });

        if (!day || days.indexOf(day) === -1) {
          day = days.indexOf(localToday()) !== -1 ? localToday() : days[days.length - 1];
        }

        clear(body);

        var chips = h("div", { class: "chips" });

        days.forEach(function (d) {
          chips.appendChild(h("button", {
            class: "chip" + (d === day ? " active" : ""),
            type: "button",
            onClick: function () { day = d; load(); },
            text: dateLabel(d)
          }));
        });

        body.appendChild(chips);

        matches.filter(function (m) { return String(m.scheduled_at || "").slice(0, 10) === day; }).forEach(function (m) {

          var st = MATCH_STATUS[m.status] || ["", "soon"];
          var winA = m.winner_team_id && m.winner_team_id === m.team_a_id;
          var winB = m.winner_team_id && m.winner_team_id === m.team_b_id;

          body.appendChild(h("div", { class: "night-card match match-" + st[1] }, [
            h("div", { class: "match-head" }, [
              h("span", { class: "muted", text: String(m.scheduled_at || "").slice(11, 16) + "・" + (MATCH_FORMATS[m.match_format] || "") }),
              h("span", { class: "tag tag-" + st[1], text: st[0] })
            ]),
            h("div", { class: "match-body" }, [
              h("span", { class: "match-side" + (winB ? " lose" : "") }, [h("strong", { text: m.team_a_name || m.player_a_name || "—" })]),
              h("strong", { class: "match-score", text: (m.score_a === null ? "–" : m.score_a) + " : " + (m.score_b === null ? "–" : m.score_b) }),
              h("span", { class: "match-side" + (winA ? " lose" : "") }, [h("strong", { text: m.team_b_name || m.player_b_name || "—" })])
            ])
          ]));
        });

        if (!matches.length) {
          body.appendChild(stateText("還沒有賽程。"));
        }
      }).catch(function () {
        clear(body);
        body.appendChild(stateText("賽程載入失敗。", "error"));
      });
    }

    drawTabs();
    load();

    state.leagueTimer = setInterval(function () {
      if (tab === "schedule" && !document.hidden) {
        load();
      }
    }, 15000);
  }


  /* =======================================================
     初始化
  ======================================================= */

  loadSite().then(renderFooter);

  loadStaff().then(function () {
    renderMenu();
    route();
  });

})();
