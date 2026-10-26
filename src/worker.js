/* =========================================================
   OURSPACE
   Cloudflare Worker 入口
   /api/auth/*     後台登入
   /api/admin/*    管理員
   /api/referee/*  裁判計分
   /api/referee/checkin/*、/api/checkin/*  報到 / 名單 / 抽獎
   /api/member/*                           會員（LINE 登入）
   /api/referee/members/*                  審核中心、會員管理
   /api/ads/*、/api/referee/ads/*          官網浮動廣告
   /api/brackets/*                         比賽賽程（獨立資料庫 BRACKET_DB）
   /api/*          官網公開 API
   其他            靜態檔案（public/）
========================================================= */

import { handlePublicApi } from "./public-api.js";
import { handleAuthApi } from "./auth.js";
import { handleAdminApi } from "./admin-api.js";
import { handleRefereeApi } from "./referee-api.js";
import { handleCheckinApi } from "./checkin-api.js";
import { handleMemberApi } from "./member-api.js";
import { handleMemberAdminApi } from "./member-admin-api.js";
import { handleAdsApi } from "./ads-api.js";
import { handleBracketApi } from "./bracket-api.js";
import { handleTrackApi } from "./track-api.js";
import { errorResponse } from "./util.js";


export default {
  async fetch(request, env) {

    var url = new URL(request.url);
    var pathname = url.pathname;

    if (pathname.indexOf("/api/") !== 0) {

      if (env.ASSETS && env.ASSETS.fetch) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not Found", { status: 404 });
    }

    try {

      var response = null;

      if (pathname.indexOf("/api/auth/") === 0) {
        response = await handleAuthApi(request, url, env);
      } else if (pathname.indexOf("/api/admin/") === 0) {
        response = await handleAdminApi(request, url, env);
      } else if (pathname.indexOf("/api/ads/") === 0 || pathname === "/api/referee/ads" || pathname.indexOf("/api/referee/ads/") === 0) {
        response = await handleAdsApi(request, url, env);
      } else if (pathname === "/api/track") {
        response = await handleTrackApi(request, env);
      } else if (pathname === "/api/brackets" || pathname.indexOf("/api/brackets/") === 0) {
        response = await handleBracketApi(request, url, env);
      } else if (pathname.indexOf("/api/member/") === 0) {
        response = await handleMemberApi(request, url, env);
      } else if (pathname.indexOf("/api/referee/members/") === 0) {
        response = await handleMemberAdminApi(request, url, env);
      } else if (
        pathname.indexOf("/api/referee/checkin/") === 0 ||
        pathname === "/api/referee/checkin" ||
        pathname.indexOf("/api/checkin/") === 0
      ) {
        response = await handleCheckinApi(request, url, env);
      } else if (pathname.indexOf("/api/referee/") === 0) {
        response = await handleRefereeApi(request, url, env);
      } else {
        response = await handlePublicApi(request, url, env);
      }

      return response || errorResponse("API_NOT_FOUND", 404);

    } catch (error) {

      console.error("Worker Error:", error);

      /* 常見情況：還沒執行 migration */
      if (String(error && error.message).indexOf("no such table") !== -1) {
        return errorResponse("DATABASE_NOT_READY", 500);
      }

      return errorResponse("INTERNAL_SERVER_ERROR", 500);

    }

  }
};
