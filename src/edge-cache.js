/* =========================================================
   OURSPACE
   公開資料的暫存（減少資料庫讀取量）

   每個人看到都一樣的公開資料（賽事名單、排行榜、戰隊、消息…），
   第一次讀資料庫後先暫存起來，在有效時間內直接回傳暫存的那份。

   - Cloudflare 邊緣快取（caches.default）：綁自己的網域後才會生效
   - Worker 記憶體暫存：workers.dev 網址也有效（每台機器各自暫存）
   - 網址帶 ?_= 的請求（例如剛報名完要看最新資料）不使用暫存
========================================================= */

var RULES = [
  { test: /^\/api\/checkin\/images\/\d+$/, ttl: 86400 },
  { test: /^\/api\/checkin\/(site|highlights)$/, ttl: 60 },
  { test: /^\/api\/checkin\/events$/, ttl: 30 },
  { test: /^\/api\/(news|news\/images|teams|ranking|tournaments)$/, ttl: 60 },
  { test: /^\/api\/ranking\/[A-Za-z0-9]+$/, ttl: 60 },
  { test: /^\/api\/league(\/standings)?$/, ttl: 30 }
];

var MEMORY = new Map();
var MEMORY_LIMIT = 120;


function ruleFor(request, url) {

  if (request.method !== "GET" || url.searchParams.has("_")) {
    return null;
  }

  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i].test.test(url.pathname)) {
      return RULES[i];
    }
  }

  return null;
}


export async function withEdgeCache(request, url, ctx, produce) {

  var rule = ruleFor(request, url);

  if (!rule) {
    return produce();
  }

  var key = url.origin + url.pathname + url.search;
  var now = Date.now();

  /* 1. 記憶體暫存 */
  var memo = MEMORY.get(key);

  if (memo && memo.expires > now) {
    return new Response(memo.body, { status: 200, headers: memo.headers });
  }

  /* 2. 邊緣快取（自己的網域才有作用；workers.dev 會直接略過） */
  var cache = null;
  var cacheKey = new Request(key, { method: "GET" });

  try {
    cache = caches.default;
    var hit = await cache.match(cacheKey);
    if (hit) {
      return hit;
    }
  } catch (error) {
    cache = null;
  }

  /* 3. 讀資料庫 */
  var response = await produce();

  if (!response || response.status !== 200) {
    return response;
  }

  var body = await response.arrayBuffer();
  var headers = new Headers(response.headers);

  headers.set("Cache-Control", "public, max-age=" + Math.min(rule.ttl, 60) + ", s-maxage=" + rule.ttl);

  if (MEMORY.size >= MEMORY_LIMIT) {
    MEMORY.delete(MEMORY.keys().next().value);
  }

  MEMORY.set(key, { body: body, headers: headers, expires: now + rule.ttl * 1000 });

  if (cache && ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers: headers })).catch(function () {}));
  }

  return new Response(body, { status: 200, headers: headers });
}
