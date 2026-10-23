/* =========================================================
   OURSPACE / 窩室
   後台：廣告管理（官網浮動廣告）
   由 admin.js 呼叫 window.OurSpaceAds.render()
   不使用 Template Literal
========================================================= */

(function () {

  "use strict";

  var API = "/api/referee/ads";
  var A = null;

  var ad = {
    main: null,
    days: 30,
    view: "list",
    editing: null
  };

  var STATES = {
    on: ["刊登中", "ck-tag-green"],
    off: ["已停用", "ck-tag-brown"],
    scheduled: ["尚未開始", "ck-tag-gold"],
    ended: ["已結束", "ck-tag-brown"]
  };

  function el(tag, className, text) { return A.el(tag, className, text); }
  function button(text, className, onClick) { return A.button(text, className, onClick); }
  function clear(node) { A.clear(node); }
  function toast(message, type) { A.toast(message, type); }
  function api(method, path, body) { return A.api(method, API + path, body); }

  function errorText(error) {
    var map = {
      INVALID_URL: "連結只接受 https:// 開頭的網址。",
      INVALID_DATE: "結束日期不能早於開始日期。",
      IMAGE_TOO_LARGE: "圖片太大了，請換一張小一點的。",
      REQUIRED: "請填寫廣告名稱。"
    };
    return map[error && error.code] || A.errorText(error);
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


  function render(tabId, main) {

    A = window.OurSpaceAdmin;
    ad.main = main;
    ad.view = "list";

    load();
  }

  function stop() {}


  /* =======================================================
     列表 + 成效
  ======================================================= */

  function load() {

    clear(ad.main);
    ad.main.appendChild(el("p", "empty", "載入中…"));

    api("GET", "?days=" + ad.days)
      .then(function (response) {
        drawList(response.data || []);
      })
      .catch(function (error) {
        toast(errorText(error), "error");
      });
  }


  function drawList(list) {

    var main = ad.main;

    clear(main);

    main.appendChild(head("廣告管理", button("＋ 新增廣告", "btn btn-primary", function () {
      openEdit(null);
    })));

    main.appendChild(el("p", "view-hint", "廣告會浮在官網畫面下緣中間（首頁不顯示），訪客可以按左上角的 × 關掉。同時有多則刊登中時，每次會依「出現比重」隨機挑一則。"));

    /* 顯示方式：關掉之後多久再出現 */
    var modeBox = el("div", "ck-block ad-mode");
    modeBox.appendChild(el("span", "field-label", "訪客關掉廣告之後"));

    var modeSeg = el("div", "ck-seg");

    function drawMode(mode) {
      clear(modeSeg);
      [["refresh", "重新整理頁面就再出現"], ["24h", "24 小時內不再出現"]].forEach(function (item) {
        modeSeg.appendChild(button(item[1], "ck-seg-btn" + (mode === item[0] ? " active" : ""), function () {
          api("PUT", "/config", { close_mode: item[0] })
            .then(function (res) {
              ad.closeMode = res.close_mode;
              drawMode(res.close_mode);
              toast("已更新顯示方式。", "success");
            })
            .catch(function (error) {
              toast(errorText(error), "error");
            });
        }));
      });
    }

    drawMode(ad.closeMode || "refresh");
    modeBox.appendChild(modeSeg);
    modeBox.appendChild(el("span", "field-help", "「24 小時內不再出現」是記在訪客自己的手機或電腦上，換一台裝置還是會看到。"));
    main.appendChild(modeBox);

    api("GET", "/config").then(function (res) {
      if (res.close_mode !== ad.closeMode) {
        ad.closeMode = res.close_mode;
        drawMode(res.close_mode);
      }
    }).catch(function () {});

    var seg = el("div", "ck-seg");

    [[7, "近 7 天"], [30, "近 30 天"], [90, "近 90 天"], [0, "全部"]].forEach(function (item) {
      var node = button(item[1], "ck-seg-btn" + (ad.days === item[0] ? " active" : ""), function () {
        ad.days = item[0];
        load();
      });
      seg.appendChild(node);
    });

    main.appendChild(seg);

    if (!list.length) {
      main.appendChild(el("p", "empty", "還沒有廣告。按「＋ 新增廣告」上傳第一則。"));
      return;
    }

    var cards = el("div", "ck-cards");

    list.forEach(function (item) {
      cards.appendChild(adCard(item));
    });

    main.appendChild(cards);
    main.appendChild(el("p", "field-help", "觀看＝廣告出現在訪客畫面上的次數；關閉率＝按 × 的次數 ÷ 觀看；點擊率＝點進連結的次數 ÷ 觀看。"));
  }


  function adCard(item) {

    var card = el("div", "ck-card ad-card");
    var tags = el("div", "ck-tags");
    var state = STATES[item.state] || STATES.off;

    tags.appendChild(el("span", "ck-tag " + state[1], state[0]));
    tags.appendChild(el("span", "ck-tag-note",
      (item.start_date || "即日起") + " ～ " + (item.end_date || "不限") + (Number(item.weight) > 1 ? "・比重 " + item.weight : "")));

    card.appendChild(tags);

    if (item.image_url) {
      var img = el("img", "ad-preview");
      img.src = item.image_url;
      img.alt = item.title;
      card.appendChild(img);
    } else {
      card.appendChild(el("div", "ad-preview ad-preview-empty", "還沒有上傳圖片，不會顯示"));
    }

    card.appendChild(el("strong", "ck-card-title", item.title));

    if (item.link_url) {
      card.appendChild(el("span", "ck-card-sub ad-url", item.link_url));
    }

    var stats = el("div", "ck-stats ck-stats-small ad-stats");

    [["觀看", item.views], ["關閉率", item.close_rate + "%"], ["點擊率", item.click_rate + "%"]].forEach(function (s) {
      var box = el("div", "ck-stat");
      box.appendChild(el("strong", null, String(s[1])));
      box.appendChild(el("span", null, s[0]));
      stats.appendChild(box);
    });

    card.appendChild(stats);
    card.appendChild(el("span", "ck-card-sub", "關閉 " + item.closes + " 次・點擊 " + item.clicks + " 次"));

    var actions = el("div", "ck-actions");

    actions.appendChild(button("編輯／換圖", "btn btn-ghost", function () {
      openEdit(item);
    }));

    actions.appendChild(button(Number(item.is_active) === 1 ? "停用" : "啟用", "btn btn-ghost", function () {
      api("PUT", "/" + item.id, {
        title: item.title,
        image_id: item.image_id,
        link_url: item.link_url,
        start_date: item.start_date,
        end_date: item.end_date,
        weight: item.weight,
        is_active: Number(item.is_active) === 1 ? 0 : 1
      })
        .then(function () {
          toast(Number(item.is_active) === 1 ? "已停用。" : "已啟用。", "success");
          load();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }));

    actions.appendChild(button("刪除", "btn btn-danger", function () {

      if (!window.confirm("刪除「" + item.title + "」？這則廣告的統計也會一起刪除。")) {
        return;
      }

      api("DELETE", "/" + item.id)
        .then(function () {
          toast("已刪除。", "success");
          load();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        });
    }));

    card.appendChild(actions);

    return card;
  }


  /* =======================================================
     新增 / 編輯
  ======================================================= */

  function openEdit(item) {

    var main = ad.main;
    var isEdit = !!item;
    var form = {
      image_id: isEdit ? item.image_id : null,
      image_url: isEdit ? item.image_url : null,
      active: isEdit ? Number(item.is_active) === 1 : true
    };

    clear(main);

    main.appendChild(head(isEdit ? "編輯廣告" : "新增廣告", button("‹ 廣告管理", "btn btn-ghost btn-small", load)));

    var wrap = el("div", "ck-form");
    var block = el("div", "ck-block");

    var title = input("text", isEdit ? item.title : "", { maxlength: "60", placeholder: "例如：一番賞開抽（只有後台看得到）" });
    var link = input("url", isEdit ? item.link_url : "", { placeholder: "https://…（選填，點廣告會開啟這個網址）" });
    var start = input("date", isEdit ? item.start_date : "");
    var end = input("date", isEdit ? item.end_date : "");
    var weight = input("number", isEdit ? item.weight : 1, { min: "1", max: "100", inputmode: "numeric" });

    /* 圖片 */
    var imageBox = el("div", "ck-poster");
    var preview = el("div", "ad-float-preview");

    function drawImage() {

      clear(imageBox);
      clear(preview);

      imageBox.appendChild(el("span", "field-label", "廣告圖片（建議細長橫幅，例如 1200 × 250；手機上會顯示成約 340 × 72 的橫幅）"));

      if (form.image_url) {

        var img = el("img");
        img.src = form.image_url;
        img.alt = "廣告預覽";

        preview.appendChild(el("span", "ad-float-close", "×"));
        preview.appendChild(img);

        imageBox.appendChild(preview);
        imageBox.appendChild(button("換一張圖片", "btn btn-ghost btn-small", pick));

      } else {
        imageBox.appendChild(button("點一下上傳廣告圖片", "ck-upload", pick));
      }
    }

    function pick() {

      var fileInput = input("file", "", { accept: "image/*" });

      fileInput.addEventListener("change", function () {

        var file = fileInput.files && fileInput.files[0];

        if (!file) {
          return;
        }

        var reader = new FileReader();

        reader.onload = function () {

          var img = new Image();

          img.onload = function () {

            var scale = Math.min(1, 1200 / img.width);
            var canvas = document.createElement("canvas");

            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

            api("POST", "/images", { mime: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] })
              .then(function (response) {
                form.image_id = response.data.id;
                form.image_url = response.data.url;
                toast("圖片已上傳。", "success");
                drawImage();
              })
              .catch(function (error) {
                toast(errorText(error), "error");
              });
          };

          img.src = reader.result;
        };

        reader.readAsDataURL(file);
      });

      fileInput.click();
    }

    drawImage();

    var activeSwitch = button("", "ck-switch-row", function () {
      form.active = !form.active;
      drawSwitch();
    });

    function drawSwitch() {
      clear(activeSwitch);
      activeSwitch.setAttribute("role", "switch");
      activeSwitch.setAttribute("aria-checked", form.active ? "true" : "false");
      activeSwitch.appendChild(el("span", null, "刊登這則廣告"));
      activeSwitch.appendChild(el("span", "ck-switch" + (form.active ? " on" : "")));
    }

    drawSwitch();

    var dateRow = el("div", "ck-row");

    dateRow.appendChild(field("開始日期（選填）", start));
    dateRow.appendChild(field("結束日期（選填）", end));

    block.appendChild(field("廣告名稱", title));
    block.appendChild(imageBox);
    block.appendChild(field("點擊後開啟的網址", link));
    block.appendChild(dateRow);
    block.appendChild(field("出現比重", weight, "同時有多則刊登中時，比重越高越常出現。只有一則的話不用改。"));
    block.appendChild(activeSwitch);

    wrap.appendChild(block);
    main.appendChild(wrap);

    var bar = el("div", "ck-bottom-bar");

    var save = button("儲存", "btn btn-primary", function () {

      save.disabled = true;

      api(isEdit ? "PUT" : "POST", isEdit ? "/" + item.id : "", {
        title: title.value,
        image_id: form.image_id,
        link_url: link.value,
        start_date: start.value,
        end_date: end.value,
        weight: Number(weight.value) || 1,
        is_active: form.active ? 1 : 0
      })
        .then(function () {
          toast(isEdit ? "廣告已更新。" : "廣告已新增。", "success");
          load();
        })
        .catch(function (error) {
          toast(errorText(error), "error");
        })
        .then(function () {
          save.disabled = false;
        });
    });

    bar.appendChild(button("取消", "btn btn-ghost", load));
    bar.appendChild(save);

    main.appendChild(bar);
  }


  window.OurSpaceAds = {
    tabs: ["ads"],
    render: render,
    stop: stop
  };

})();
