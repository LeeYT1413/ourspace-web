
/* =========================================================
   OURSPACE / 窩室
   Main Application JavaScript
   Frontend Controller
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";


  /* =======================================================
     01. DOM
  ======================================================= */

  var body = document.body;

  var sidebar = document.getElementById("sidebar");

  var sidebarToggle = document.getElementById("sidebarToggle");

  var mobileMenuButton = document.getElementById("mobileMenuButton");

  var mobileOverlay = document.getElementById("mobileOverlay");

  var navItems = document.querySelectorAll(".nav-item");

  var pages = document.querySelectorAll(".page");


  /* =======================================================
     02. PAGE DATA
  ======================================================= */

  var pageTitles = {
    dashboard: "最新消息",
    league: "戰隊聯賽",
    ranking: "陀螺爭霸",
    tournaments: "賽事報名"
  };


  /* =======================================================
     03. SIDEBAR
  ======================================================= */

  function toggleSidebar() {

    if (!body) {
      return;
    }

    body.classList.toggle("sidebar-collapsed");

    saveSidebarState();

  }


  function saveSidebarState() {

    try {

      var collapsed =
        body.classList.contains("sidebar-collapsed");

      localStorage.setItem(
        "ourspace_sidebar_collapsed",
        collapsed ? "1" : "0"
      );

    } catch (error) {

      console.log(
        "無法儲存 Sidebar 狀態",
        error
      );

    }

  }


  function loadSidebarState() {

    try {

      var state =
        localStorage.getItem(
          "ourspace_sidebar_collapsed"
        );

      if (state === "1") {

        body.classList.add(
          "sidebar-collapsed"
        );

      }

    } catch (error) {

      console.log(
        "無法讀取 Sidebar 狀態",
        error
      );

    }

  }


  if (sidebarToggle) {

    sidebarToggle.addEventListener(
      "click",
      function () {

        if (window.innerWidth <= 760) {

          closeMobileSidebar();

          return;

        }

        toggleSidebar();

      }
    );

  }


  /* =======================================================
     04. MOBILE SIDEBAR
  ======================================================= */

  function openMobileSidebar() {

    if (!sidebar) {
      return;
    }

    sidebar.classList.add(
      "mobile-open"
    );

    if (mobileOverlay) {

      mobileOverlay.classList.add(
        "active"
      );

    }

    body.classList.add(
      "mobile-menu-open"
    );

  }


  function closeMobileSidebar() {

    if (sidebar) {

      sidebar.classList.remove(
        "mobile-open"
      );

    }

    if (mobileOverlay) {

      mobileOverlay.classList.remove(
        "active"
      );

    }

    body.classList.remove(
      "mobile-menu-open"
    );

  }


  if (mobileMenuButton) {

    mobileMenuButton.addEventListener(
      "click",
      function () {

        if (
          sidebar &&
          sidebar.classList.contains(
            "mobile-open"
          )
        ) {

          closeMobileSidebar();

        } else {

          openMobileSidebar();

        }

      }
    );

  }


  if (mobileOverlay) {

    mobileOverlay.addEventListener(
      "click",
      function () {

        closeMobileSidebar();

      }
    );

  }


  /* =======================================================
     05. PAGE NAVIGATION
  ======================================================= */

  function switchPage(pageName) {

    if (!pageName) {
      return;
    }


    var targetPage =
      document.getElementById(
        "page-" + pageName
      );


    if (!targetPage) {

      console.warn(
        "找不到頁面：",
        pageName
      );

      return;

    }


    /* Hide all pages */

    pages.forEach(function (page) {

      page.classList.remove(
        "active"
      );

    });


    /* Show target */

    targetPage.classList.add(
      "active"
    );


    /* Update nav */

    navItems.forEach(function (item) {

      var itemPage =
        item.getAttribute(
          "data-page"
        );

      if (itemPage === pageName) {

        item.classList.add(
          "active"
        );

      } else {

        item.classList.remove(
          "active"
        );

      }

    });


    /* Update title */

    updatePageTitle(
      pageName
    );


    /* Close mobile menu */

    closeMobileSidebar();


    /* Scroll to top */

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });


    /* Save current page */

    try {

      localStorage.setItem(
        "ourspace_current_page",
        pageName
      );

    } catch (error) {

      console.log(
        "無法儲存目前頁面",
        error
      );

    }

  }


  function updatePageTitle(pageName) {

    var title =
      document.getElementById(
        "pageTitle"
      );

    var subtitle =
      document.getElementById(
        "pageSubtitle"
      );


    if (title) {

      if (
        pageTitles[pageName]
      ) {

        title.textContent =
          pageTitles[pageName];

      } else {

        title.textContent =
          "窩室 OurSpace";

      }

    }


    if (subtitle) {

      subtitle.textContent =
        "OURSPACE BATTLE ARENA";

    }

  }


  navItems.forEach(function (item) {

    item.addEventListener(
      "click",
      function () {

        var page =
          item.getAttribute(
            "data-page"
          );

        if (page) {

          switchPage(page);

        }

      }
    );

  });


  /* =======================================================
     06. BUTTON PAGE LINKS
  ======================================================= */

  var pageLinks =
    document.querySelectorAll(
      "[data-go-page]"
    );


  pageLinks.forEach(function (element) {

    element.addEventListener(
      "click",
      function () {

        var page =
          element.getAttribute(
            "data-go-page"
          );

        if (page) {

          switchPage(page);

        }

      }
    );

  });


  /* =======================================================
     07. LOAD CURRENT PAGE
  ======================================================= */

  function loadCurrentPage() {

    var defaultPage =
      "dashboard";

    var currentPage =
      defaultPage;


    try {

      var savedPage =
        localStorage.getItem(
          "ourspace_current_page"
        );

      if (
        savedPage &&
        document.getElementById(
          "page-" + savedPage
        )
      ) {

        currentPage =
          savedPage;

      }

    } catch (error) {

      console.log(
        "無法讀取目前頁面",
        error
      );

    }


    switchPage(
      currentPage
    );

  }


  /* =======================================================
     08. PHOTO SLIDER
  ======================================================= */

  var currentSlide =
    0;

  var slideTimer =
    null;


  function getSlides() {

    return document.querySelectorAll(
      ".slide"
    );

  }


  function getSliderDots() {

    return document.querySelectorAll(
      ".slider-dot"
    );

  }


  function showSlide(index) {

    var slides =
      getSlides();

    var dots =
      getSliderDots();


    if (
      !slides ||
      slides.length === 0
    ) {

      return;

    }


    if (
      index >= slides.length
    ) {

      index = 0;

    }


    if (
      index < 0
    ) {

      index =
        slides.length - 1;

    }


    currentSlide =
      index;


    slides.forEach(
      function (slide, slideIndex) {

        if (
          slideIndex === currentSlide
        ) {

          slide.classList.add(
            "active"
          );

        } else {

          slide.classList.remove(
            "active"
          );

        }

      }
    );


    dots.forEach(
      function (dot, dotIndex) {

        if (
          dotIndex === currentSlide
        ) {

          dot.classList.add(
            "active"
          );

        } else {

          dot.classList.remove(
            "active"
          );

        }

      }
    );

  }


  function nextSlide() {

    showSlide(
      currentSlide + 1
    );

    restartSlider();

  }


  function previousSlide() {

    showSlide(
      currentSlide - 1
    );

    restartSlider();

  }


  function startSlider() {

    var slides =
      getSlides();


    if (
      !slides ||
      slides.length <= 1
    ) {

      return;

    }


    stopSlider();


    slideTimer =
      setInterval(
        function () {

          showSlide(
            currentSlide + 1
          );

        },
        5000
      );

  }


  function stopSlider() {

    if (slideTimer) {

      clearInterval(
        slideTimer
      );

      slideTimer =
        null;

    }

  }


  function restartSlider() {

    stopSlider();

    startSlider();

  }


  var nextButton =
    document.getElementById(
      "sliderNext"
    );


  var previousButton =
    document.getElementById(
      "sliderPrev"
    );


  if (nextButton) {

    nextButton.addEventListener(
      "click",
      nextSlide
    );

  }


  if (previousButton) {

    previousButton.addEventListener(
      "click",
      previousSlide
    );

  }


  var dots =
    document.querySelectorAll(
      ".slider-dot"
    );


  dots.forEach(
    function (dot, index) {

      dot.addEventListener(
        "click",
        function () {

          showSlide(
            index
          );

          restartSlider();

        }
      );

    }
  );


  var slider =
    document.querySelector(
      ".photo-slider"
    );


  if (slider) {

    slider.addEventListener(
      "mouseenter",
      stopSlider
    );


    slider.addEventListener(
      "mouseleave",
      startSlider
    );

  }


  /* =======================================================
     09. TOUCH SWIPE
  ======================================================= */

  var touchStartX =
    0;

  var touchEndX =
    0;


  if (slider) {

    slider.addEventListener(
      "touchstart",
      function (event) {

        if (
          event.touches &&
          event.touches.length > 0
        ) {

          touchStartX =
            event.touches[0].clientX;

        }

      },
      {
        passive: true
      }
    );


    slider.addEventListener(
      "touchend",
      function (event) {

        if (
          event.changedTouches &&
          event.changedTouches.length > 0
        ) {

          touchEndX =
            event.changedTouches[0].clientX;

          handleSwipe();

        }

      },
      {
        passive: true
      }
    );

  }


  function handleSwipe() {

    var distance =
      touchEndX - touchStartX;


    if (
      Math.abs(distance) < 50
    ) {

      return;

    }


    if (
      distance < 0
    ) {

      nextSlide();

    } else {

      previousSlide();

    }

  }


  /* =======================================================
     10. TOURNAMENT DATA
  ======================================================= */

  var tournaments = [

    {
      id: 1,
      type: "team",
      typeName: "戰隊賽",
      status: "open",
      statusName: "報名中",
      title: "窩室戰隊聯賽 第一季",
      date: "2026 / 10 / 18",
      time: "19:00",
      location: "窩室競技場",
      quota: "8 隊"
    },

    {
      id: 2,
      type: "solo",
      typeName: "個人賽",
      status: "open",
      statusName: "報名中",
      title: "陀螺爭霸月賽 VOL.01",
      date: "2026 / 10 / 25",
      time: "14:00",
      location: "窩室競技場",
      quota: "32 人"
    },

    {
      id: 3,
      type: "team",
      typeName: "戰隊賽",
      status: "coming",
      statusName: "即將開放",
      title: "窩室戰隊聯賽 第二季",
      date: "2026 / 11 / 08",
      time: "19:00",
      location: "窩室競技場",
      quota: "8 隊"
    },

    {
      id: 4,
      type: "solo",
      typeName: "個人賽",
      status: "coming",
      statusName: "即將開放",
      title: "冬季陀螺爭霸戰",
      date: "2026 / 12 / 06",
      time: "13:00",
      location: "窩室競技場",
      quota: "64 人"
    }

  ];


  var currentTournamentFilter =
    "all";


  /* =======================================================
     11. TOURNAMENT FILTER
  ======================================================= */

  var filterButtons =
    document.querySelectorAll(
      ".filter-button"
    );


  filterButtons.forEach(
    function (button) {

      button.addEventListener(
        "click",
        function () {

          var filter =
            button.getAttribute(
              "data-filter"
            );


          if (!filter) {

            filter =
              "all";

          }


          currentTournamentFilter =
            filter;


          filterButtons.forEach(
            function (item) {

              item.classList.remove(
                "active"
              );

            }
          );


          button.classList.add(
            "active"
          );


          renderTournamentList();

        }
      );

    }
  );


  /* =======================================================
     12. TOURNAMENT SEARCH
  ======================================================= */

  var tournamentSearch =
    document.getElementById(
      "tournamentSearch"
    );


  if (tournamentSearch) {

    tournamentSearch.addEventListener(
      "input",
      function () {

        renderTournamentList();

      }
    );

  }


  function getTournamentSearchKeyword() {

    if (!tournamentSearch) {

      return "";

    }


    return String(
      tournamentSearch.value || ""
    )
      .trim()
      .toLowerCase();

  }


  function tournamentMatchesFilter(
    tournament
  ) {

    if (
      currentTournamentFilter ===
      "all"
    ) {

      return true;

    }


    if (
      currentTournamentFilter ===
      "team"
    ) {

      return (
        tournament.type ===
        "team"
      );

    }


    if (
      currentTournamentFilter ===
      "solo"
    ) {

      return (
        tournament.type ===
        "solo"
      );

    }


    if (
      currentTournamentFilter ===
      "open"
    ) {

      return (
        tournament.status ===
        "open"
      );

    }


    return true;

  }


  function tournamentMatchesSearch(
    tournament,
    keyword
  ) {

    if (!keyword) {

      return true;

    }


    var text =
      (
        tournament.title +
        " " +
        tournament.typeName +
        " " +
        tournament.statusName +
        " " +
        tournament.date +
        " " +
        tournament.location
      )
        .toLowerCase();


    return text.indexOf(
      keyword
    ) !== -1;

  }


  /* =======================================================
     13. RENDER TOURNAMENT LIST
  ======================================================= */

  function renderTournamentList() {

    var container =
      document.getElementById(
        "tournamentList"
      );


    if (!container) {

      return;

    }


    var keyword =
      getTournamentSearchKeyword();


    var filtered =
      tournaments.filter(
        function (tournament) {

          return (
            tournamentMatchesFilter(
              tournament
            ) &&
            tournamentMatchesSearch(
              tournament,
              keyword
            )
          );

        }
      );


    container.innerHTML =
      "";


    if (
      filtered.length === 0
    ) {

      var empty =
        document.createElement(
          "div"
        );

      empty.className =
        "tournament-empty";

      empty.textContent =
        "目前沒有符合條件的賽事";

      container.appendChild(
        empty
      );

      return;

    }


    filtered.forEach(
      function (tournament) {

        var card =
          createTournamentCard(
            tournament
          );

        container.appendChild(
          card
        );

      }
    );

  }


  function createTournamentCard(
    tournament
  ) {

    var card =
      document.createElement(
        "article"
      );


    card.className =
      "tournament-card";


    var image =
      document.createElement(
        "div"
      );


    image.className =
      "tournament-image";


    var imageIcon =
      document.createElement(
        "span"
      );


    if (
      tournament.type ===
      "team"
    ) {

      imageIcon.textContent =
        "⚔";

    } else {

      imageIcon.textContent =
        "◉";

    }


    image.appendChild(
      imageIcon
    );


    var content =
      document.createElement(
        "div"
      );


    content.className =
      "tournament-content";


    var tag =
      document.createElement(
        "div"
      );


    tag.className =
      "tournament-tag";


    tag.textContent =
      tournament.typeName +
      " / " +
      tournament.statusName;


    var title =
      document.createElement(
        "h2"
      );


    title.textContent =
      tournament.title;


    var info =
      document.createElement(
        "div"
      );


    info.className =
      "tournament-info";


    var date =
      document.createElement(
        "span"
      );


    date.textContent =
      "📅 " +
      tournament.date;


    var time =
      document.createElement(
        "span"
      );


    time.textContent =
      "◷ " +
      tournament.time;


    var location =
      document.createElement(
        "span"
      );


    location.textContent =
      "⌖ " +
      tournament.location;


    var quota =
      document.createElement(
        "span"
      );


    quota.textContent =
      "👥 " +
      tournament.quota;


    info.appendChild(
      date
    );

    info.appendChild(
      time
    );

    info.appendChild(
      location
    );

    info.appendChild(
      quota
    );


    var button =
      document.createElement(
        "button"
      );


    button.className =
      "primary-button tournament-button";


    if (
      tournament.status ===
      "open"
    ) {

      button.innerHTML =
        "立即報名 <strong>→</strong>";


      button.addEventListener(
        "click",
        function () {

          openRegistration(
            tournament
          );

        }
      );

    } else {

      button.innerHTML =
        "尚未開放 <strong>•</strong>";

      button.disabled =
        true;

      button.style.opacity =
        "0.45";

      button.style.cursor =
        "not-allowed";

    }


    content.appendChild(
      tag
    );

    content.appendChild(
      title
    );

    content.appendChild(
      info
    );

    content.appendChild(
      button
    );


    card.appendChild(
      image
    );

    card.appendChild(
      content
    );


    return card;

  }


  /* =======================================================
     14. REGISTRATION
  ======================================================= */

  function openRegistration(
    tournament
  ) {

    if (!tournament) {

      return;

    }


    console.log(
      "準備報名賽事：",
      tournament.title
    );


    /*
      目前先切換到賽事報名頁。

      下一階段串接 Cloudflare D1
      + LINE Login
      + 金流後，
      這裡會改成真正的報名流程。
    */

    switchPage(
      "tournaments"
    );


    showRegistrationMessage(
      tournament
    );

  }


  function showRegistrationMessage(
    tournament
  ) {

    var oldMessage =
      document.querySelector(
        ".registration-message"
      );


    if (oldMessage) {

      oldMessage.remove();

    }


    var container =
      document.getElementById(
        "tournamentList"
      );


    if (!container) {

      return;

    }


    var message =
      document.createElement(
        "div"
      );


    message.className =
      "registration-message";


    message.textContent =
      "已選擇：「" +
      tournament.title +
      "」";


    container.insertBefore(
      message,
      container.firstChild
    );


    setTimeout(
      function () {

        if (
          message &&
          message.parentNode
        ) {

          message.remove();

        }

      },
      3000
    );

  }


  /* =======================================================
     15. LEAGUE MATCH DEMO DATA
  ======================================================= */

  var leagueMatches = [

    {
      time: "20:00",
      teamA: "戰隊 C",
      teamB: "戰隊 D",
      scoreA: "5",
      scoreB: "4",
      status: "finished",
      statusName: "比賽結束"
    },

    {
      time: "21:30",
      teamA: "戰隊 A",
      teamB: "戰隊 B",
      scoreA: "2",
      scoreB: "3",
      status: "finished",
      statusName: "比賽結束"
    },

    {
      time: "23:00",
      teamA: "戰隊 E",
      teamB: "戰隊 F",
      scoreA: "-",
      scoreB: "-",
      status: "upcoming",
      statusName: "未開賽"
    }

  ];


  /* =======================================================
     16. RENDER LEAGUE MATCHES
  ======================================================= */

  function renderLeagueMatches() {

    var container =
      document.getElementById(
        "matchList"
      );


    if (!container) {

      return;

    }


    container.innerHTML =
      "";


    leagueMatches.forEach(
      function (match) {

        var card =
          document.createElement(
            "article"
          );


        card.className =
          "match-card " +
          match.status;


        var time =
          document.createElement(
            "div"
          );


        time.className =
          "match-time";


        var timeText =
          document.createElement(
            "span"
          );


        timeText.textContent =
          match.time;


        var timeStatus =
          document.createElement(
            "small"
          );


        timeStatus.textContent =
          match.statusName;


        time.appendChild(
          timeText
        );

        time.appendChild(
          timeStatus
        );


        var teams =
          document.createElement(
            "div"
          );


        teams.className =
          "match-teams";


        var teamA =
          createTeamElement(
            match.teamA,
            false
          );


        var score =
          document.createElement(
            "div"
          );


        score.className =
          "match-score";


        var scoreStrong =
          document.createElement(
            "strong"
          );


        scoreStrong.textContent =
          match.scoreA +
          " : " +
          match.scoreB;


        var scoreStatus =
          document.createElement(
            "span"
          );


        scoreStatus.textContent =
          match.statusName;


        score.appendChild(
          scoreStrong
        );

        score.appendChild(
          scoreStatus
        );


        var teamB =
          createTeamElement(
            match.teamB,
            true
          );


        teams.appendChild(
          teamA
        );

        teams.appendChild(
          score
        );

        teams.appendChild(
          teamB
        );


        card.appendChild(
          time
        );

        card.appendChild(
          teams
        );


        container.appendChild(
          card
        );

      }
    );

  }


  function createTeamElement(
    name,
    reverse
  ) {

    var team =
      document.createElement(
        "div"
      );


    team.className =
      "team";


    if (reverse) {

      team.classList.add(
        "team-b"
      );

    }


    var logo =
      document.createElement(
        "div"
      );


    logo.className =
      "team-logo";


    logo.textContent =
      "⚔";


    var teamName =
      document.createElement(
        "span"
      );


    teamName.className =
      "team-name";


    teamName.textContent =
      name;


    team.appendChild(
      logo
    );

    team.appendChild(
      teamName
    );


    return team;

  }


  /* =======================================================
     17. RESPONSIVE
  ======================================================= */

  window.addEventListener(
    "resize",
    function () {

      if (
        window.innerWidth > 760
      ) {

        closeMobileSidebar();

      }

    }
  );


  /* =======================================================
     18. INITIALIZE
  ======================================================= */

  function init() {

    loadSidebarState();

    loadCurrentPage();

    showSlide(0);

    startSlider();

    renderTournamentList();

    renderLeagueMatches();

  }


  init();


})();
