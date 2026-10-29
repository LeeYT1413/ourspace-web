/* =========================================================
   OURSPACE / 窩室
   時間欄位：可以直接打數字，也可以用滾輪選（24 小時制、分鐘每 10 分一格）

   用法：var input = OurSpaceTimeInput("14:00", { empty: "未定" });
   回傳的是一般的 <input>，用 input.value 讀寫（"HH:MM" 或 ""）。
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var ITEM = 36;
  var HOURS = [];
  var MINUTES = ["00", "10", "20", "30", "40", "50"];
  var open = null;

  for (var i = 0; i < 24; i++) {
    HOURS.push(i < 10 ? "0" + i : String(i));
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* 打字時：只留數字，超過兩位自動加冒號 */
  function typing(raw) {
    var d = String(raw).replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? d.slice(0, 2) + ":" + d.slice(2) : d;
  }

  /* 離開欄位時整理成 HH:MM；分鐘照 10 分一格往下取整 */
  function normalize(raw) {

    var d = String(raw).replace(/\D/g, "").slice(0, 4);

    if (!d) {
      return "";
    }

    var h;
    var m;

    if (d.length <= 2) {
      h = Number(d);
      m = 0;
    } else if (d.length === 3) {
      h = Number(d.slice(0, 1));
      m = Number(d.slice(1));
    } else {
      h = Number(d.slice(0, 2));
      m = Number(d.slice(2));
    }

    if (h > 23 || m > 59) {
      return null;
    }

    return pad(h) + ":" + pad(Math.floor(m / 10) * 10);
  }

  function emit(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }


  /* ---------- 滾輪 ---------- */

  function column(list, label) {

    var col = document.createElement("div");
    col.className = "tw-col";
    col.setAttribute("aria-label", label);

    var pad1 = document.createElement("div");
    pad1.className = "tw-pad";
    col.appendChild(pad1);

    list.forEach(function (text) {
      var item = document.createElement("div");
      item.className = "tw-item";
      item.textContent = text;
      col.appendChild(item);
    });

    var pad2 = document.createElement("div");
    pad2.className = "tw-pad";
    col.appendChild(pad2);

    return col;
  }

  function closeWheel() {
    if (open) {
      open.panel.remove();
      document.removeEventListener("pointerdown", open.outside, true);
      window.removeEventListener("scroll", open.reposition, true);
      window.removeEventListener("resize", open.reposition);
      open = null;
    }
  }

  function openWheel(input) {

    if (open && open.input === input) {
      return;
    }

    closeWheel();

    var panel = document.createElement("div");
    panel.className = "tw-panel";

    var hourCol = column(HOURS, "時");
    var minCol = column(MINUTES, "分");
    var colon = document.createElement("span");
    colon.className = "tw-colon";
    colon.textContent = ":";

    var band = document.createElement("div");
    band.className = "tw-band";

    var cols = document.createElement("div");
    cols.className = "tw-cols";
    cols.appendChild(band);
    cols.appendChild(hourCol);
    cols.appendChild(colon);
    cols.appendChild(minCol);

    var done = document.createElement("button");
    done.type = "button";
    done.className = "tw-done";
    done.textContent = "完成";
    done.addEventListener("click", closeWheel);

    panel.appendChild(cols);
    panel.appendChild(done);
    document.body.appendChild(panel);

    var syncing = false;
    var timer = null;

    function scrollToValue(value, smooth) {

      var parts = /^(\d{2}):(\d{2})$/.exec(value || "");
      var h = parts ? Number(parts[1]) : new Date().getHours();
      var m = parts ? Math.floor(Number(parts[2]) / 10) : 0;

      syncing = true;
      hourCol.scrollTo({ top: h * ITEM, behavior: smooth ? "smooth" : "auto" });
      minCol.scrollTo({ top: m * ITEM, behavior: smooth ? "smooth" : "auto" });
      setTimeout(function () { syncing = false; }, smooth ? 300 : 30);
    }

    function onScroll() {

      if (syncing) {
        return;
      }

      clearTimeout(timer);

      timer = setTimeout(function () {
        var h = Math.max(0, Math.min(23, Math.round(hourCol.scrollTop / ITEM)));
        var m = Math.max(0, Math.min(5, Math.round(minCol.scrollTop / ITEM)));
        var value = HOURS[h] + ":" + MINUTES[m];

        if (input.value !== value) {
          input.value = value;
          emit(input);
        }
      }, 120);
    }

    hourCol.addEventListener("scroll", onScroll);
    minCol.addEventListener("scroll", onScroll);

    /* 點某一格直接選 */
    [hourCol, minCol].forEach(function (col) {
      col.addEventListener("click", function (event) {
        var item = event.target.closest(".tw-item");
        if (item) {
          var index = Array.prototype.indexOf.call(col.querySelectorAll(".tw-item"), item);
          col.scrollTo({ top: index * ITEM, behavior: "smooth" });
        }
      });
    });

    function reposition() {

      var rect = input.getBoundingClientRect();
      var width = 220;
      var height = panel.offsetHeight || 250;
      var left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      var top = rect.bottom + 6;

      if (top + height > window.innerHeight - 8 && rect.top - height - 6 > 8) {
        top = rect.top - height - 6;
      }

      panel.style.left = left + "px";
      panel.style.top = top + "px";
    }

    function outside(event) {
      if (!panel.contains(event.target) && event.target !== input) {
        closeWheel();
      }
    }

    open = { input: input, panel: panel, outside: outside, reposition: reposition, sync: scrollToValue };

    reposition();
    scrollToValue(input.value, false);

    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }


  /* ---------- 欄位 ---------- */

  /* 把一個現有的 <input> 變成時間欄位 */
  function enhance(input, options) {

    options = options || {};

    var last = input.value || "";

    input.type = "text";
    input.classList.add("time-input");
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.maxLength = 5;

    if (options.empty !== undefined) {
      input.placeholder = options.empty === null ? "HH:MM" : options.empty;
    } else if (!input.placeholder) {
      input.placeholder = "HH:MM";
    }

    if (options.label) {
      input.setAttribute("aria-label", options.label);
    }

    /* 程式設定值（例如開啟編輯視窗）：不經過整理，保留舊資料原本的時間 */
    input.setTime = function (value, empty) {
      input.value = value || "";
      last = input.value;
      if (empty !== undefined) {
        input.placeholder = empty;
      }
    };

    input.addEventListener("focus", function () {
      openWheel(input);
      setTimeout(function () { input.select(); }, 0);
    });

    input.addEventListener("click", function () {
      openWheel(input);
    });

    input.addEventListener("input", function (event) {

      /* 滾輪觸發的 input 不用再整理 */
      if (event.isTrusted === false) {
        last = input.value;
        return;
      }

      var formatted = typing(input.value);

      if (formatted !== input.value) {
        input.value = formatted;
      }

      var full = /^\d{2}:\d{2}$/.test(formatted) ? normalize(formatted) : null;

      if (full && open && open.input === input) {
        open.sync(full, true);
      }
    });

    input.addEventListener("blur", function () {

      /* 沒改過就不動（保留舊資料不是整 10 分的時間） */
      if (input.value === last) {
        return;
      }

      var result = normalize(input.value);

      if (result === null || (result === "" && options.empty === null)) {
        input.value = last;
        return;
      }

      if (result !== last) {
        input.value = result;
        last = result;
        emit(input);
      } else {
        input.value = result;
      }
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
        closeWheel();
      }
    });

    return input;
  }

  window.OurSpaceTimeInput = function (value, options) {

    options = options || {};

    var input = document.createElement("input");

    input.value = value || "";

    if (options.className) {
      input.className = options.className;
    }

    return enhance(input, { empty: options.empty === undefined ? "HH:MM" : options.empty, label: options.label });
  };

  window.OurSpaceTimeInput.enhance = enhance;

})();
