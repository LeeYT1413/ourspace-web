/* =========================================================
   OURSPACE / 窩室
   Main Application JavaScript
   Frontend Controller（串接 Cloudflare D1 API）
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";


  /* =======================================================
     00. 網站設定（請填入實際網址）
  ======================================================= */

  var SITE_LINKS = {
    line: "",        // 例：https://lin.ee/xxxxxxx
    facebook: "",    // 例：https://www.facebook.com/xxxxx
    instagram: ""    // 例：https://www.instagram.com/xxxxx
  };


  /* =======================================================
     01. 常數
  ======================================================= */

  var DEFAULT_PAGE = "news";

  var PAGES = {
    news: { title: "最新消息", subtitle: "OURSPACE NEWS" },
    league: { title: "戰隊聯賽", subtitle: "TEAM BATTLE LEAGUE" },
    ranking: { title: "陀螺爭霸", subtitle: "TOP SPINNERS" },
    tournaments: { title: "賽事報名", subtitle: "JOIN THE BATTLE" }
  };

  var TOURNAMENT_TYPES = {
    team: { name: "戰隊賽", tag: "TEAM BATTLE", icon: "⚔" },
    solo: { name: "個人賽", tag: "SOLO BATTLE", icon: "◈" }
  };

  var TOURNAMENT_STATUSES = {
    open: { name: "報名中", tag: "OPEN" },
    coming: { name: "即將開放", tag: "COMING SOON" },
    ongoing: { name: "進行中", tag: "LIVE" },
    closed: { name: "報名截止", tag: "CLOSED" },
    finished: { name: "已結束", tag: "FINISHED" }
  };

  var MATCH_STATUSES = {
    scheduled: { name: "未開賽", tag: "UPCOMING", css: "upcoming" },
    live: { name: "比賽中", tag: "LIVE", css: "live" },
    finished: { name: "比賽結束", tag: "FINISHED", css: "finished" },
    cancelled: { name: "已取消", tag: "CANCELLED", css: "cancelled" }
  };

  var RANK_TIERS = [
    { css: "rank-1", label: "CHAMPION", badge: "GOLD" },
    { css: "rank-2", label: "RUNNER UP", badge: "SILVER" },
    { css: "rank-3", label: "TOP 3", badge: "BRONZE" }
  ];

  var MONTHS = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
  ];

  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];


  /* =======================================================
     02. 共用工具
  ======================================================= */

  function byId(id) {
    return document.getElementById(id);
  }


  /* 建立元素；文字一律用 textContent，避免資料庫內容被當成 HTML */
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

    if (!node) {
      return;
    }

    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }


  function pad2(value) {

    var text = String(value);

    return text.length < 2 ? "0" + text : text;
  }


  function cssToken(value) {

    return String(value || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
  }


  function initialOf(name) {

    var text = String(name || "").trim();

    if (!text) {
      return "?";
    }

    return Array.from(text)[0].toUpperCase();
  }


  /* 只允許 http(s) 或站內路徑，擋掉 javascript: 之類的網址 */
  function safeUrl(value) {

    if (!value) {
      return "";
    }

    var text = String(value).trim();

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (
      (text.charAt(0) === "/" && text.indexOf("//") !== 0) ||
      text.charAt(0) === "#"
    ) {
      return text;
    }

    return "";
  }


  function isExternal(url) {
    return /^https?:\/\//i.test(url);
  }


  function formatMoney(value) {

    var number = Number(value) || 0;

    if (number <= 0) {
      return "免費";
    }

    return "NT$ " + number.toLocaleString("zh-TW");
  }


  /* 文字依換行切成段落 */
  function appendParagraphs(container, text) {

    String(text || "")
      .split(/\n+/)
      .forEach(function (line) {

        line = line.trim();

        if (line) {
          container.appendChild(el("p", null, line));
        }
      });
  }


  function bindActivate(node, handler) {

    node.addEventListener("click", handler);

    node.addEventListener("keydown", function (event) {

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  }


  /* =======================================================
     03. 日期
     資料庫時間假設為台灣時間字串：YYYY-MM-DD HH:MM(:SS)
     直接解析字串，不做時區換算
  ======================================================= */

  function parseDateTime(value) {

    if (!value) {
      return null;
    }

    var match = String(value).match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/
    );

    if (!match) {
      return null;
    }

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: match[4] !== undefined ? Number(match[4]) : null,
      minute: match[5] !== undefined ? Number(match[5]) : null,
      key: match[1] + "-" + pad2(match[2]) + "-" + pad2(match[3])
    };
  }


  function todayKey() {

    var now = new Date();

    return (
      now.getFullYear() + "-" +
      pad2(now.getMonth() + 1) + "-" +
      pad2(now.getDate())
    );
  }


  function weekdayOf(parts) {

    var date = new Date(parts.year, parts.month - 1, parts.day);

    return WEEKDAYS[date.getDay()];
  }


  function formatDate(parts) {

    if (!parts) {
      return "即將公布";
    }

    return parts.year + " / " + pad2(parts.month) + " / " + pad2(parts.day);
  }


  function formatTime(parts) {

    if (!parts || parts.hour === null) {
      return "";
    }

    return pad2(parts.hour) + ":" + pad2(parts.minute);
  }


  function formatDateTime(value) {

    var parts = parseDateTime(value);

    if (!parts) {
      return "即將公布";
    }

    var time = formatTime(parts);

    return (
      formatDate(parts) +
      "（" + weekdayOf(parts) + "）" +
      (time ? " " + time : "")
    );
  }


  /* =======================================================
     04. API
  ======================================================= */

  function apiGet(path) {

    return fetch(path, {
      headers: { "Accept": "application/json" }
    })
      .then(function (response) {

        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {

            if (!response.ok || !data || !data.success) {
              throw new Error(
                (data && data.error) || ("HTTP_" + response.status)
              );
            }

            return data;
          });
      });
  }


  /* 載入中 / 空資料 / 錯誤 */
  function renderState(container, type, message) {

    if (!container) {
      return;
    }

    clear(container);

    var box = el("div", "data-state data-state-" + type);

    var icon = "—";

    if (type === "loading") {
      icon = "◌";
    }

    if (type === "error") {
      icon = "!";
    }

    box.appendChild(el("span", "data-state-icon", icon));
    box.appendChild(el("p", null, message));

    container.appendChild(box);
  }


  /* =======================================================
     05. DOM
  ======================================================= */

  var body = document.body;

  var sidebar = byId("sidebar");
  var sidebarToggle = byId("sidebarToggle");
  var mobileMenuButton = byId("mobileMenuButton");
  var mobileOverlay = byId("mobileOverlay");

  var navItems = document.querySelectorAll(".nav-item");
  var pages = document.querySelectorAll(".page");

  var topbarTitle = byId("topbarTitle");
  var topbarSubtitle = byId("topbarSubtitle");


  /* =======================================================
     06. SIDEBAR
  ======================================================= */

  function toggleSidebar() {

    body.classList.toggle("sidebar-collapsed");

    try {
      localStorage.setItem(
        "ourspace_sidebar_collapsed",
        body.classList.contains("sidebar-collapsed") ? "1" : "0"
      );
    } catch (error) {
      /* 無痕模式等情況無法儲存，忽略 */
    }
  }


  function loadSidebarState() {

    try {
      if (localStorage.getItem("ourspace_sidebar_collapsed") === "1") {
        body.classList.add("sidebar-collapsed");
      }
    } catch (error) {
      /* 忽略 */
    }
  }


  function openMobileSidebar() {

    if (sidebar) {
      sidebar.classList.add("mobile-open");
    }

    if (mobileOverlay) {
      mobileOverlay.classList.add("active");
    }

    body.classList.add("mobile-menu-open");
  }


  function closeMobileSidebar() {

    if (sidebar) {
      sidebar.classList.remove("mobile-open");
    }

    if (mobileOverlay) {
      mobileOverlay.classList.remove("active");
    }

    body.classList.remove("mobile-menu-open");
  }


  if (sidebarToggle) {

    sidebarToggle.addEventListener("click", function () {

      if (window.innerWidth <= 760) {
        closeMobileSidebar();
        return;
      }

      toggleSidebar();
    });
  }


  if (mobileMenuButton) {

    mobileMenuButton.addEventListener("click", function () {

      if (sidebar && sidebar.classList.contains("mobile-open")) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }


  if (mobileOverlay) {
    mobileOverlay.addEventListener("click", closeMobileSidebar);
  }


  window.addEventListener("resize", function () {

    if (window.innerWidth > 760) {
      closeMobileSidebar();
    }
  });


  /* =======================================================
     07. 換頁（使用網址 #news / #league / #ranking / #tournaments）
     好處：可以直接分享某一頁的連結，瀏覽器上一頁也能用
  ======================================================= */

  function getPageFromHash() {

    var name = (window.location.hash || "").replace("#", "");

    return PAGES[name] ? name : DEFAULT_PAGE;
  }


  function showPage(pageName) {

    if (!PAGES[pageName]) {
      pageName = DEFAULT_PAGE;
    }

    pages.forEach(function (page) {
      page.classList.toggle(
        "active",
        page.id === "page-" + pageName
      );
    });

    navItems.forEach(function (item) {

      var isActive = item.getAttribute("data-page") === pageName;

      item.classList.toggle("active", isActive);

      if (isActive) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    if (topbarTitle) {
      topbarTitle.textContent = PAGES[pageName].title;
    }

    if (topbarSubtitle) {
      topbarSubtitle.textContent = PAGES[pageName].subtitle;
    }

    document.title = PAGES[pageName].title + "｜OurSpace 窩室";

    closeMobileSidebar();

    window.scrollTo(0, 0);
  }


  function goToPage(pageName) {

    if (window.location.hash === "#" + pageName) {
      showPage(pageName);
    } else {
      window.location.hash = pageName;
    }
  }


  window.addEventListener("hashchange", function () {

    var page = getPageFromHash();

    showPage(page);

    /* 切到聯賽頁時立即抓最新比分 */
    if (page === "league" && typeof loadLeague === "function") {
      loadLeague(true);
    }
  });


  navItems.forEach(function (item) {

    item.addEventListener("click", function () {
      goToPage(item.getAttribute("data-page"));
    });
  });


  /* 任何帶 data-page-link 的元素都可以換頁 */
  document.addEventListener("click", function (event) {

    var target = event.target.closest
      ? event.target.closest("[data-page-link]")
      : null;

    if (target) {
      goToPage(target.getAttribute("data-page-link"));
    }
  });


  /* =======================================================
     08. 聯絡連結 / Footer
  ======================================================= */

  function applySiteLinks() {

    var map = {
      contactLine: SITE_LINKS.line,
      contactFacebook: SITE_LINKS.facebook,
      contactInstagram: SITE_LINKS.instagram
    };

    Object.keys(map).forEach(function (id) {

      var link = byId(id);
      var url = safeUrl(map[id]);

      if (!link) {
        return;
      }

      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
      } else {
        link.classList.add("is-pending");
        link.setAttribute("aria-disabled", "true");
        link.addEventListener("click", function (event) {
          event.preventDefault();
        });
      }
    });

    var year = byId("footerYear");

    if (year) {
      year.textContent = String(new Date().getFullYear());
    }
  }


  /* =======================================================
     09. 詳情視窗
  ======================================================= */

  var modal = byId("detailModal");
  var modalBody = byId("modalBody");
  var modalCloseButton = byId("modalCloseButton");
  var lastFocused = null;


  function openModal(content) {

    if (!modal || !modalBody) {
      return;
    }

    lastFocused = document.activeElement;

    clear(modalBody);
    modalBody.appendChild(content);

    modal.hidden = false;
    body.classList.add("modal-open");

    if (modalCloseButton) {
      modalCloseButton.focus();
    }
  }


  function closeModal() {

    if (!modal || modal.hidden) {
      return;
    }

    modal.hidden = true;
    body.classList.remove("modal-open");

    if (lastFocused && lastFocused.focus) {
      lastFocused.focus();
    }
  }


  if (modal) {

    modal.addEventListener("click", function (event) {

      if (
        event.target.closest &&
        event.target.closest("[data-modal-close]")
      ) {
        closeModal();
      }
    });
  }


  document.addEventListener("keydown", function (event) {

    if (event.key === "Escape") {
      closeModal();
    }
  });


  function createModalInfo(items) {

    var grid = el("div", "modal-info");

    items.forEach(function (item) {

      if (!item.value) {
        return;
      }

      var box = el("div", "modal-info-item");

      box.appendChild(el("small", null, item.label));
      box.appendChild(el("strong", null, item.value));

      grid.appendChild(box);
    });

    return grid;
  }


  /* =======================================================
     10. 照片輪播
  ======================================================= */

  var photoSlider = byId("photoSlider");
  var sliderTrack = byId("sliderTrack");
  var sliderDots = byId("sliderDots");

  var currentSlide = 0;
  var slideTimer = null;


  function getSlides() {
    return sliderTrack ? sliderTrack.querySelectorAll(".slide") : [];
  }


  function showSlide(index) {

    var slides = getSlides();

    if (!slides.length) {
      return;
    }

    if (index >= slides.length) {
      index = 0;
    }

    if (index < 0) {
      index = slides.length - 1;
    }

    currentSlide = index;

    slides.forEach(function (slide, i) {
      slide.classList.toggle("active", i === index);
    });

    if (sliderDots) {
      sliderDots.querySelectorAll(".slider-dot").forEach(function (dot, i) {
        dot.classList.toggle("active", i === index);
      });
    }
  }


  function stopSlider() {

    if (slideTimer) {
      clearInterval(slideTimer);
      slideTimer = null;
    }
  }


  function startSlider() {

    stopSlider();

    if (getSlides().length <= 1) {
      return;
    }

    slideTimer = setInterval(function () {
      showSlide(currentSlide + 1);
    }, 5000);
  }


  function buildSliderDots() {

    if (!sliderDots) {
      return;
    }

    clear(sliderDots);

    var count = getSlides().length;

    if (photoSlider) {
      photoSlider.classList.toggle("is-single", count <= 1);
    }

    if (count <= 1) {
      return;
    }

    for (var i = 0; i < count; i++) {

      (function (index) {

        var dot = el("button", "slider-dot");

        dot.type = "button";
        dot.setAttribute("aria-label", "第 " + (index + 1) + " 張");

        dot.addEventListener("click", function () {
          showSlide(index);
          startSlider();
        });

        sliderDots.appendChild(dot);

      })(i);
    }
  }


  function createImageSlide(item, index) {

    var link = safeUrl(item.link_url);
    var slide = el(link ? "a" : "div", "slide slide-has-image");

    if (link) {

      slide.href = link;

      if (isExternal(link)) {
        slide.target = "_blank";
        slide.rel = "noopener";
      }
    }

    var image = el("img", "slide-image");

    image.src = safeUrl(item.image_url);
    image.alt = item.title || "窩室賽事現場";
    image.decoding = "async";

    if (index > 0) {
      image.loading = "lazy";
    }

    slide.appendChild(image);

    if (item.title || item.subtitle) {

      var caption = el("div", "slide-caption");

      if (item.title) {
        caption.appendChild(el("div", "slide-caption-title", item.title));
      }

      if (item.subtitle) {
        caption.appendChild(el("div", "slide-caption-subtitle", item.subtitle));
      }

      slide.appendChild(caption);
    }

    return slide;
  }


  function initSliderControls() {

    var prev = byId("sliderPrev");
    var next = byId("sliderNext");

    if (prev) {
      prev.addEventListener("click", function () {
        showSlide(currentSlide - 1);
        startSlider();
      });
    }

    if (next) {
      next.addEventListener("click", function () {
        showSlide(currentSlide + 1);
        startSlider();
      });
    }

    if (!photoSlider) {
      return;
    }

    photoSlider.addEventListener("mouseenter", stopSlider);
    photoSlider.addEventListener("mouseleave", startSlider);


    /* 手機左右滑動 */
    var touchStartX = 0;

    photoSlider.addEventListener("touchstart", function (event) {

      if (event.touches && event.touches.length) {
        touchStartX = event.touches[0].clientX;
      }

    }, { passive: true });

    photoSlider.addEventListener("touchend", function (event) {

      if (!event.changedTouches || !event.changedTouches.length) {
        return;
      }

      var distance = event.changedTouches[0].clientX - touchStartX;

      if (Math.abs(distance) < 50) {
        return;
      }

      showSlide(distance < 0 ? currentSlide + 1 : currentSlide - 1);
      startSlider();

    }, { passive: true });


    /* 分頁切到背景時暫停 */
    document.addEventListener("visibilitychange", function () {

      if (document.hidden) {
        stopSlider();
      } else {
        startSlider();
      }
    });
  }


  function loadSlider() {

    buildSliderDots();
    showSlide(0);
    startSlider();

    return apiGet("/api/news/images")
      .then(function (response) {

        var images = (response.data || []).filter(function (item) {
          return safeUrl(item.image_url);
        });

        /* 沒有照片就保留預設畫面 */
        if (!images.length) {
          return;
        }

        clear(sliderTrack);

        images.forEach(function (item, index) {
          sliderTrack.appendChild(createImageSlide(item, index));
        });

        buildSliderDots();
        showSlide(0);
        startSlider();
      })
      .catch(function (error) {
        console.warn("輪播照片載入失敗，使用預設畫面", error);
      });
  }


  /* =======================================================
     11. 最新公告
  ======================================================= */

  var newsList = byId("newsList");


  function createNewsCard(item) {

    var card = el("article", "news-card is-clickable");

    card.tabIndex = 0;
    card.setAttribute("role", "button");

    var parts = parseDateTime(item.published_at);

    var date = el("div", "news-date");
    date.appendChild(el("span", null, parts ? pad2(parts.day) : "--"));
    date.appendChild(el("small", null, parts ? MONTHS[parts.month - 1] : "NEW"));

    var content = el("div", "news-body");
    content.appendChild(
      el("div", "news-tag", String(item.category || "news").toUpperCase())
    );
    content.appendChild(el("h3", null, item.title));

    if (item.summary) {
      content.appendChild(el("p", null, item.summary));
    }

    card.appendChild(date);
    card.appendChild(content);
    card.appendChild(el("div", "news-arrow", "→"));

    bindActivate(card, function () {
      openNewsModal(item);
    });

    return card;
  }


  function openNewsModal(item) {

    var wrapper = el("div");

    var cover = safeUrl(item.cover_image_url);

    if (cover) {
      var image = el("img", "modal-cover");
      image.src = cover;
      image.alt = item.title || "";
      wrapper.appendChild(image);
    }

    var content = el("div", "modal-content");

    var kicker =
      String(item.category || "news").toUpperCase() +
      " / " +
      formatDate(parseDateTime(item.published_at));

    content.appendChild(el("div", "modal-kicker", kicker));

    var title = el("h2", null, item.title);
    title.id = "modalTitle";
    content.appendChild(title);

    var text = el("div", "modal-text");
    appendParagraphs(text, item.content || item.summary || "");
    content.appendChild(text);

    wrapper.appendChild(content);

    openModal(wrapper);
  }


  function loadNews() {

    renderState(newsList, "loading", "公告載入中…");

    return apiGet("/api/news")
      .then(function (response) {

        var items = response.data || [];

        if (!items.length) {
          renderState(newsList, "empty", "目前沒有公告，新消息會第一時間公布在這裡。");
          return;
        }

        clear(newsList);

        items.slice(0, 10).forEach(function (item) {
          newsList.appendChild(createNewsCard(item));
        });
      })
      .catch(function (error) {
        console.error("公告載入失敗", error);
        renderState(newsList, "error", "公告載入失敗，請重新整理頁面。");
      });
  }


  /* =======================================================
     12. 賽事
  ======================================================= */

  var tournamentList = byId("tournamentList");
  var tournamentSearch = byId("tournamentSearch");
  var filterButtons = document.querySelectorAll(".filter-button");

  var tournaments = [];
  var currentFilter = "all";
  var tournamentsLoaded = false;


  function getTypeInfo(tournament) {

    return TOURNAMENT_TYPES[tournament.tournament_type] || {
      name: tournament.tournament_type || "賽事",
      tag: "EVENT",
      icon: "◆"
    };
  }


  function getStatusInfo(tournament) {

    return TOURNAMENT_STATUSES[tournament.status] || {
      name: tournament.status || "",
      tag: String(tournament.status || "").toUpperCase()
    };
  }


  function getQuotaText(tournament) {

    if (tournament.max_teams) {
      return tournament.max_teams + " 隊";
    }

    if (tournament.max_players) {
      return tournament.max_players + " 人";
    }

    return "";
  }


  function matchesFilter(tournament) {

    if (currentFilter === "all") {
      return true;
    }

    if (currentFilter === "open") {
      return tournament.status === "open";
    }

    return tournament.tournament_type === currentFilter;
  }


  function matchesSearch(tournament, keyword) {

    if (!keyword) {
      return true;
    }

    var text = [
      tournament.title,
      tournament.description,
      tournament.location,
      getTypeInfo(tournament).name,
      getStatusInfo(tournament).name
    ].join(" ").toLowerCase();

    return text.indexOf(keyword) !== -1;
  }


  function renderTournamentList() {

    if (!tournamentList || !tournamentsLoaded) {
      return;
    }

    var keyword = tournamentSearch
      ? String(tournamentSearch.value || "").trim().toLowerCase()
      : "";

    var filtered = tournaments.filter(function (tournament) {
      return matchesFilter(tournament) && matchesSearch(tournament, keyword);
    });

    if (!filtered.length) {
      renderState(
        tournamentList,
        "empty",
        tournaments.length
          ? "沒有符合條件的賽事，試試其他關鍵字或篩選。"
          : "目前沒有公開的賽事，新賽事會公布在這裡。"
      );
      return;
    }

    clear(tournamentList);

    filtered.forEach(function (tournament) {
      tournamentList.appendChild(createTournamentCard(tournament));
    });
  }


  function createTournamentCard(tournament) {

    var typeInfo = getTypeInfo(tournament);
    var statusInfo = getStatusInfo(tournament);
    var statusCss = cssToken(tournament.status);

    var card = el("article", "tournament-card status-" + statusCss);


    /* 圖片區 */
    var image = el("div", "tournament-image");
    var cover = safeUrl(tournament.cover_image_url);

    if (cover) {

      var img = el("img");
      img.src = cover;
      img.alt = tournament.title || "";
      img.loading = "lazy";

      image.appendChild(img);
      image.classList.add("has-cover");

    } else {
      image.appendChild(el("span", null, typeInfo.icon));
    }

    image.appendChild(
      el("span", "tournament-status status-" + statusCss, statusInfo.name)
    );


    /* 內容區 */
    var content = el("div", "tournament-content");

    content.appendChild(el("div", "tournament-tag", typeInfo.tag));
    content.appendChild(el("h2", null, tournament.title));

    if (tournament.description) {
      content.appendChild(el("p", "tournament-desc", tournament.description));
    }

    var info = el("div", "tournament-info");
    var start = parseDateTime(tournament.start_at);

    info.appendChild(el("span", null, "📅 " + formatDate(start)));

    if (formatTime(start)) {
      info.appendChild(el("span", null, "⏰ " + formatTime(start)));
    }

    if (tournament.location) {
      info.appendChild(el("span", null, "📍 " + tournament.location));
    }

    if (getQuotaText(tournament)) {
      info.appendChild(el("span", null, "👥 " + getQuotaText(tournament)));
    }

    info.appendChild(el("span", null, "🎫 " + formatMoney(tournament.entry_fee)));

    content.appendChild(info);


    /* 按鈕 */
    var button = el(
      "button",
      tournament.status === "open"
        ? "primary-button tournament-button"
        : "secondary-button tournament-button"
    );

    button.type = "button";
    button.appendChild(el("span", null, "查看賽事"));
    button.appendChild(el("strong", null, "→"));

    button.addEventListener("click", function () {
      openTournamentModal(tournament);
    });

    content.appendChild(button);


    card.appendChild(image);
    card.appendChild(content);

    return card;
  }


  function openTournamentModal(tournament) {

    var typeInfo = getTypeInfo(tournament);
    var statusInfo = getStatusInfo(tournament);

    var wrapper = el("div");

    var cover = safeUrl(tournament.cover_image_url);

    if (cover) {
      var image = el("img", "modal-cover");
      image.src = cover;
      image.alt = tournament.title || "";
      wrapper.appendChild(image);
    }

    var content = el("div", "modal-content");

    content.appendChild(
      el("div", "modal-kicker", typeInfo.tag + " / " + statusInfo.name)
    );

    var title = el("h2", null, tournament.title);
    title.id = "modalTitle";
    content.appendChild(title);


    var registrationPeriod = "";

    if (tournament.registration_start_at || tournament.registration_end_at) {
      registrationPeriod =
        formatDateTime(tournament.registration_start_at) +
        " ～ " +
        formatDateTime(tournament.registration_end_at);
    }

    var endDate = parseDateTime(tournament.end_at);
    var schedule = formatDateTime(tournament.start_at);

    if (endDate && tournament.end_at !== tournament.start_at) {
      schedule += " ～ " + formatDateTime(tournament.end_at);
    }

    content.appendChild(createModalInfo([
      { label: "比賽時間", value: schedule },
      { label: "地點", value: tournament.location },
      { label: "賽制", value: typeInfo.name },
      { label: "名額", value: getQuotaText(tournament) },
      { label: "報名費", value: formatMoney(tournament.entry_fee) },
      { label: "報名期間", value: registrationPeriod }
    ]));


    if (tournament.description) {
      var text = el("div", "modal-text");
      appendParagraphs(text, tournament.description);
      content.appendChild(text);
    }


    /* 報名區：線上報名完成前，先導到 LINE */
    var action = el("div", "modal-action");
    var lineUrl = safeUrl(SITE_LINKS.line);

    if (tournament.status === "open") {

      action.appendChild(
        el("p", null, "線上報名即將開放，目前請透過 LINE 官方帳號報名。")
      );

      if (lineUrl) {
        var lineButton = el("a", "primary-button");
        lineButton.href = lineUrl;
        lineButton.target = "_blank";
        lineButton.rel = "noopener";
        lineButton.appendChild(el("span", null, "LINE 報名"));
        lineButton.appendChild(el("strong", null, "→"));
        action.appendChild(lineButton);
      }

    } else if (tournament.status === "coming") {

      action.appendChild(
        el("p", null, "報名尚未開放，開放時間會公布在最新消息。")
      );

    } else {

      action.appendChild(el("p", null, "此賽事目前不開放報名。"));
    }

    content.appendChild(action);

    wrapper.appendChild(content);

    openModal(wrapper);
  }


  /* 首頁主打賽事 */
  var featuredTournament = null;


  function renderFeaturedEvent() {

    var section = byId("featuredSection");

    if (!section) {
      return;
    }

    function firstWithStatus(status) {
      for (var i = 0; i < tournaments.length; i++) {
        if (tournaments[i].status === status) {
          return tournaments[i];
        }
      }
      return null;
    }

    featuredTournament =
      firstWithStatus("open") ||
      firstWithStatus("coming") ||
      firstWithStatus("ongoing");

    if (!featuredTournament) {
      section.hidden = true;
      return;
    }

    var typeInfo = getTypeInfo(featuredTournament);
    var isOpen = featuredTournament.status === "open";

    byId("featuredKicker").textContent = isOpen
      ? "REGISTRATION OPEN"
      : "UPCOMING EVENT";

    byId("featuredTitle").textContent = featuredTournament.title;

    var description = String(featuredTournament.description || "");

    byId("featuredDesc").textContent = description.length > 60
      ? description.slice(0, 60) + "…"
      : description;

    var meta = byId("featuredMeta");
    clear(meta);
    meta.appendChild(
      el("span", null, "📅 " + formatDate(parseDateTime(featuredTournament.start_at)))
    );
    meta.appendChild(el("span", null, typeInfo.icon + " " + typeInfo.tag));
    meta.appendChild(el("span", null, getStatusInfo(featuredTournament).name));

    var buttonText = byId("featuredButton").querySelector("span");

    if (buttonText) {
      buttonText.textContent = isOpen ? "立即報名" : "查看賽事";
    }

    section.hidden = false;
  }


  function initTournamentControls() {

    var featuredButton = byId("featuredButton");

    if (featuredButton) {
      featuredButton.addEventListener("click", function () {
        if (featuredTournament) {
          openTournamentModal(featuredTournament);
        }
      });
    }

    filterButtons.forEach(function (button) {

      button.addEventListener("click", function () {

        currentFilter = button.getAttribute("data-filter") || "all";

        filterButtons.forEach(function (item) {
          item.classList.toggle("active", item === button);
        });

        renderTournamentList();
      });
    });

    if (tournamentSearch) {
      tournamentSearch.addEventListener("input", renderTournamentList);
    }
  }


  function loadTournaments() {

    renderState(tournamentList, "loading", "賽事載入中…");

    return apiGet("/api/tournaments")
      .then(function (response) {

        tournaments = response.data || [];
        tournamentsLoaded = true;

        renderTournamentList();
        renderFeaturedEvent();
      })
      .catch(function (error) {
        console.error("賽事載入失敗", error);
        renderState(tournamentList, "error", "賽事載入失敗，請重新整理頁面。");
      });
  }


  /* =======================================================
     13. 戰隊聯賽
  ======================================================= */

  var matchList = byId("matchList");
  var leagueDateTabs = byId("leagueDateTabs");

  var leagueGroups = [];
  var activeLeagueKey = null;


  function groupMatchesByDate(matches) {

    var map = {};
    var order = [];

    matches.forEach(function (match) {

      var parts = parseDateTime(match.scheduled_at);
      var key = parts ? parts.key : "unknown";

      if (!map[key]) {
        map[key] = { key: key, date: parts, matches: [] };
        order.push(key);
      }

      map[key].matches.push(match);
    });

    return order.map(function (key) {
      return map[key];
    });
  }


  /* 預設顯示：今天或之後最近的一天；全部都過了就顯示最後一天 */
  function pickDefaultLeagueKey(groups) {

    var today = todayKey();

    for (var i = 0; i < groups.length; i++) {
      if (groups[i].key >= today) {
        return groups[i].key;
      }
    }

    return groups.length ? groups[groups.length - 1].key : null;
  }


  function findLeagueGroup(key) {

    for (var i = 0; i < leagueGroups.length; i++) {
      if (leagueGroups[i].key === key) {
        return leagueGroups[i];
      }
    }

    return null;
  }


  function renderLeagueTabs(silent) {

    clear(leagueDateTabs);

    if (leagueGroups.length <= 1) {
      return;
    }

    leagueGroups.forEach(function (group) {

      var label = group.date
        ? pad2(group.date.month) + "/" + pad2(group.date.day) +
          "（" + weekdayOf(group.date) + "）"
        : "未定";

      var tab = el("button", "date-tab", label);

      tab.type = "button";
      tab.setAttribute("role", "tab");

      var isActive = group.key === activeLeagueKey;

      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");

      tab.addEventListener("click", function () {
        activeLeagueKey = group.key;
        renderLeagueTabs();
        renderLeagueDay();
      });

      leagueDateTabs.appendChild(tab);
    });

    /* 讓目前選取的日期出現在可視範圍 */
    var activeTab = leagueDateTabs.querySelector(".date-tab.active");

    if (!silent && activeTab && activeTab.scrollIntoView) {
      activeTab.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }


  function setLeaguePanel(label, value, time) {

    byId("leagueDateLabel").textContent = label;
    byId("leagueDateValue").textContent = value;
    byId("leagueDateTime").textContent = time;
  }


  function renderLeagueDay() {

    var group = findLeagueGroup(activeLeagueKey);

    if (!group) {
      return;
    }

    var times = group.matches
      .map(function (match) {
        return formatTime(parseDateTime(match.scheduled_at));
      })
      .filter(Boolean);

    var timeRange = "";

    if (times.length) {
      timeRange = times[0] === times[times.length - 1]
        ? times[0]
        : times[0] + " — " + times[times.length - 1];
    }

    var firstMatch = group.matches[0];
    var label = "MATCH DAY";

    if (firstMatch.tournament_title) {
      label = firstMatch.tournament_title;
    }

    if (firstMatch.round_number) {
      label += " / ROUND " + firstMatch.round_number;
    }

    setLeaguePanel(label, formatDate(group.date), timeRange);

    clear(matchList);

    group.matches.forEach(function (match) {
      matchList.appendChild(createMatchCard(match));
    });
  }


  function createTeamElement(name, logoUrl, reverse, isWinner) {

    var className = "team";

    if (reverse) {
      className += " team-b";
    }

    if (isWinner) {
      className += " is-winner";
    }

    var team = el("div", className);
    var logo = el("div", "team-logo");
    var url = safeUrl(logoUrl);

    if (url) {
      var img = el("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      logo.appendChild(img);
    } else {
      logo.textContent = initialOf(name);
    }

    team.appendChild(logo);
    team.appendChild(el("div", "team-name", name || "待定"));

    return team;
  }


  function createMatchCard(match) {

    var status = MATCH_STATUSES[match.status] || {
      name: match.status || "",
      tag: String(match.status || "").toUpperCase(),
      css: cssToken(match.status)
    };

    var parts = parseDateTime(match.scheduled_at);
    var card = el("article", "match-card " + status.css);


    var time = el("div", "match-time");
    time.appendChild(el("span", null, formatTime(parts) || "--:--"));
    time.appendChild(el("small", null, status.tag));


    var teams = el("div", "match-teams");

    var winnerId = match.winner_team_id;

    teams.appendChild(
      createTeamElement(
        match.team_a_name,
        match.team_a_logo,
        false,
        winnerId && winnerId === match.team_a_id
      )
    );


    var score = el("div", "match-score");

    var hasScore =
      match.score_a !== null && match.score_a !== undefined &&
      match.score_b !== null && match.score_b !== undefined;

    score.appendChild(
      el("strong", null, hasScore ? match.score_a + " : " + match.score_b : "VS")
    );

    var resultText = status.name;

    if (match.status === "finished" && match.winner_team_name) {
      resultText = match.winner_team_name + " 勝利";
    }

    score.appendChild(el("span", null, resultText));

    if (match.field_name) {
      score.appendChild(el("small", "match-field", match.field_name));
    }

    if (match.note) {
      score.appendChild(el("small", "match-note", match.note));
    }

    teams.appendChild(score);


    teams.appendChild(
      createTeamElement(
        match.team_b_name,
        match.team_b_logo,
        true,
        winnerId && winnerId === match.team_b_id
      )
    );


    card.appendChild(time);
    card.appendChild(teams);

    return card;
  }


  /* silent = 背景自動更新：不顯示載入中、保留目前選的日期 */
  function loadLeague(silent) {

    if (!silent) {
      renderState(matchList, "loading", "賽程載入中…");
    }

    return apiGet("/api/league")
      .then(function (response) {

        var matches = response.data || [];

        if (!matches.length) {
          leagueGroups = [];
          clear(leagueDateTabs);
          setLeaguePanel("MATCH DAY", "即將公布", "");
          renderState(matchList, "empty", "目前沒有排定的賽程，公布後會顯示在這裡。");
          return;
        }

        var previousKey = activeLeagueKey;

        leagueGroups = groupMatchesByDate(matches);

        if (!silent || !previousKey || !findLeagueGroup(previousKey)) {
          activeLeagueKey = pickDefaultLeagueKey(leagueGroups);
        }

        renderLeagueTabs(silent);
        renderLeagueDay();
      })
      .catch(function (error) {

        console.error("賽程載入失敗", error);

        /* 背景更新失敗就保留目前畫面，下次再試 */
        if (!silent) {
          setLeaguePanel("MATCH DAY", "—", "");
          renderState(matchList, "error", "賽程載入失敗，請重新整理頁面。");
        }
      });
  }


  function hasLiveMatch() {

    return leagueGroups.some(function (group) {
      return group.matches.some(function (match) {
        return match.status === "live";
      });
    });
  }


  /*
    即時比分：停留在「戰隊聯賽」頁時自動更新。
    有比賽進行中每 10 秒，沒有則每 60 秒。
  */
  var leaguePollTimer = null;

  function scheduleLeaguePoll() {

    clearTimeout(leaguePollTimer);

    leaguePollTimer = setTimeout(function () {

      if (!document.hidden && getPageFromHash() === "league") {
        loadLeague(true).then(scheduleLeaguePoll);
      } else {
        scheduleLeaguePoll();
      }

    }, hasLiveMatch() ? 10000 : 60000);
  }


  document.addEventListener("visibilitychange", function () {

    if (!document.hidden && getPageFromHash() === "league") {
      loadLeague(true);
    }
  });


  /* =======================================================
     14. 陀螺爭霸排行榜
  ======================================================= */

  var rankingBoard = byId("rankingBoard");
  var rankingSeason = byId("rankingSeason");


  function createRankingCard(item, index) {

    var tier = RANK_TIERS[index];
    var isTop = Boolean(tier);
    var displayName = item.nickname || item.player_name;

    var card = el("article", "ranking-card " + (isTop ? tier.css : "rank-normal"));

    card.appendChild(el("div", "rank-number", pad2(item.rank_number || index + 1)));

    if (index === 0) {
      card.appendChild(el("div", "rank-crown", "♛"));
    }


    var avatar = el("div", "rank-avatar");
    var avatarUrl = safeUrl(item.avatar_url);

    if (avatarUrl) {
      var img = el("img");
      img.src = avatarUrl;
      img.alt = "";
      img.loading = "lazy";
      avatar.appendChild(img);
    } else {
      avatar.textContent = initialOf(displayName);
    }

    card.appendChild(avatar);


    var info = el("div", "rank-info");

    if (isTop) {
      info.appendChild(el("div", "rank-label", tier.label));
    }

    info.appendChild(el(isTop ? "h2" : "h3", null, displayName));

    if (item.team_name) {
      info.appendChild(el("div", "rank-team", item.team_name));
    }

    var count = el("div", "rank-count");
    count.appendChild(el("strong", null, item.upper_count || 0));
    count.appendChild(el("span", null, "上位"));
    info.appendChild(count);

    info.appendChild(
      el(
        "div",
        "rank-stats",
        "勝場 " + (item.win_count || 0) + "｜積分 " + (item.points || 0)
      )
    );

    card.appendChild(info);

    card.appendChild(el("div", "rank-badge", isTop ? tier.badge : "IRON"));

    return card;
  }


  function loadRanking() {

    renderState(rankingBoard, "loading", "排行榜載入中…");

    return apiGet("/api/ranking")
      .then(function (response) {

        if (rankingSeason) {
          rankingSeason.textContent = response.season
            ? String(response.season).toUpperCase()
            : "SEASON";
        }

        var items = response.data || [];

        if (!items.length) {
          renderState(rankingBoard, "empty", "本季排行榜尚未公布。");
          return;
        }

        clear(rankingBoard);

        var normalList = el("div", "ranking-list");

        items.forEach(function (item, index) {

          var card = createRankingCard(item, index);

          if (index < 3) {
            rankingBoard.appendChild(card);
          } else {
            normalList.appendChild(card);
          }
        });

        if (normalList.childNodes.length) {
          rankingBoard.appendChild(normalList);
        }
      })
      .catch(function (error) {
        console.error("排行榜載入失敗", error);
        renderState(rankingBoard, "error", "排行榜載入失敗，請重新整理頁面。");
      });
  }


  /* =======================================================
     15. 初始化
  ======================================================= */

  function init() {

    loadSidebarState();
    applySiteLinks();

    showPage(getPageFromHash());

    initSliderControls();
    initTournamentControls();

    loadSlider();
    loadNews();
    loadTournaments();
    loadLeague().then(scheduleLeaguePoll);
    loadRanking();
  }


  init();

})();
