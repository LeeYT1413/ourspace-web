/* =========================================================
   OURSPACE
   共用工具
========================================================= */

/* 官網 GET API 快取秒數 */
export var API_CACHE_SECONDS = 30;

/* 即時比分相關 API 快取秒數 */
export var LIVE_CACHE_SECONDS = 5;

/* 戰隊聯賽：每場兩隊比分加總上限（剛好達到才能結束比賽） */
export var MAX_TOTAL_SCORE = 9;

/* 戰隊聯賽賽別：個人 / 雙人 / 三人 */
export var MATCH_FORMATS = ["solo", "duo", "trio"];


export function jsonResponse(data, status, cacheSeconds, extraHeaders) {

  var headers = new Headers({
    "Content-Type": "application/json; charset=UTF-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cacheSeconds
      ? "public, max-age=" + cacheSeconds
      : "no-store"
  });

  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (key) {
      headers.append(key, extraHeaders[key]);
    });
  }

  return new Response(
    JSON.stringify(data),
    {
      status: status || 200,
      headers: headers
    }
  );

}


export function errorResponse(error, status, extra) {

  var body = {
    success: false,
    error: error
  };

  if (extra) {
    Object.keys(extra).forEach(function (key) {
      body[key] = extra[key];
    });
  }

  return jsonResponse(body, status || 400);

}


export async function parseJsonBody(request) {

  try {
    var body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch (error) {
    return null;
  }

}


export function cleanText(value) {

  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();

}


export function isPositiveInteger(value) {

  var number = Number(value);

  return Number.isInteger(number) && number > 0;

}


/* 台灣時間（UTC+8），格式 YYYY-MM-DD HH:MM */
export function taiwanNow() {

  var date = new Date(Date.now() + 8 * 60 * 60 * 1000);

  return date.toISOString().slice(0, 16).replace("T", " ");

}


/* 台灣日期，格式 YYYY-MM-DD */
export function taiwanToday() {

  return taiwanNow().slice(0, 10);

}