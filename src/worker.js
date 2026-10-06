
/* =========================================================
   OURSPACE
   Cloudflare Worker API
   D1 Database API
   ========================================================= */

export default {
  async fetch(request, env) {

    var url = new URL(request.url);
    var pathname = url.pathname;
    var method = request.method;

    /* -----------------------------------------------------
       CORS
    ----------------------------------------------------- */

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {

      /* ---------------------------------------------------
         API ROUTER
      --------------------------------------------------- */

      if (pathname === "/api/news" && method === "GET") {
        return await getNews(env);
      }


      if (
        pathname === "/api/news/images" &&
        method === "GET"
      ) {
        return await getNewsImages(env);
      }


      if (
        pathname === "/api/tournaments" &&
        method === "GET"
      ) {
        return await getTournaments(request, env);
      }


      if (
        pathname.indexOf("/api/tournaments/") === 0 &&
        method === "GET"
      ) {

        var tournamentId =
          pathname.replace(
            "/api/tournaments/",
            ""
          );

        return await getTournament(
          tournamentId,
          env
        );
      }


      if (
        pathname === "/api/league" &&
        method === "GET"
      ) {
        return await getLeague(env);
      }


      if (
        pathname.indexOf("/api/league/") === 0 &&
        method === "GET"
      ) {

        var leagueId =
          pathname.replace(
            "/api/league/",
            ""
          );

        return await getLeagueMatch(
          leagueId,
          env
        );
      }


      if (
        pathname === "/api/ranking" &&
        method === "GET"
      ) {
        return await getRanking(request, env);
      }


      if (
        pathname === "/api/contact" &&
        method === "POST"
      ) {
        return await createContact(
          request,
          env
        );
      }


      if (
        pathname === "/api/registrations" &&
        method === "POST"
      ) {
        return await createRegistration(
          request,
          env
        );
      }


      /* ---------------------------------------------------
         API NOT FOUND
      --------------------------------------------------- */

      if (
        pathname.indexOf("/api/") === 0
      ) {

        return jsonResponse(
          {
            success: false,
            error: "API_NOT_FOUND"
          },
          404
        );

      }


      /* ---------------------------------------------------
         STATIC FILE / ASSETS
      --------------------------------------------------- */

      if (
        env.ASSETS &&
        env.ASSETS.fetch
      ) {

        return env.ASSETS.fetch(
          request
        );

      }


      return new Response(
        "OurSpace Worker is running.",
        {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=UTF-8"
          }
        }
      );

    } catch (error) {

      console.error(
        "Worker Error:",
        error
      );

      return jsonResponse(
        {
          success: false,
          error: "INTERNAL_SERVER_ERROR"
        },
        500
      );

    }

  }
};


/* =========================================================
   RESPONSE
========================================================= */

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type",
    "Content-Type":
      "application/json; charset=UTF-8"
  };

}


function jsonResponse(
  data,
  status
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status || 200,
      headers: corsHeaders()
    }
  );

}


/* =========================================================
   NEWS
========================================================= */

async function getNews(env) {

  var result =
    await env.DB.prepare(
      "SELECT " +
      "id, " +
      "title, " +
      "summary, " +
      "content, " +
      "cover_image_url, " +
      "category, " +
      "published_at " +
      "FROM news " +
      "WHERE status = ? " +
      "ORDER BY sort_order ASC, published_at DESC"
    )
    .bind("published")
    .all();


  return jsonResponse(
    {
      success: true,
      data: result.results || []
    }
  );

}


/* =========================================================
   NEWS IMAGES / SLIDER
========================================================= */

async function getNewsImages(env) {

  var result =
    await env.DB.prepare(
      "SELECT " +
      "id, " +
      "image_url, " +
      "title, " +
      "subtitle, " +
      "link_url " +
      "FROM news_images " +
      "WHERE status = ? " +
      "ORDER BY sort_order ASC, id ASC"
    )
    .bind("active")
    .all();


  return jsonResponse(
    {
      success: true,
      data: result.results || []
    }
  );

}


/* =========================================================
   TOURNAMENTS
========================================================= */

async function getTournaments(
  request,
  env
) {

  var url =
    new URL(request.url);

  var type =
    url.searchParams.get(
      "type"
    );

  var status =
    url.searchParams.get(
      "status"
    );

  var keyword =
    url.searchParams.get(
      "q"
    );


  var sql =
    "SELECT " +
    "id, " +
    "tournament_code, " +
    "title, " +
    "tournament_type, " +
    "description, " +
    "cover_image_url, " +
    "location, " +
    "start_at, " +
    "end_at, " +
    "registration_start_at, " +
    "registration_end_at, " +
    "max_players, " +
    "max_teams, " +
    "entry_fee, " +
    "status " +
    "FROM tournaments " +
    "WHERE 1 = 1";


  var bindings = [];


  if (type) {

    sql +=
      " AND tournament_type = ?";

    bindings.push(type);

  }


  if (status) {

    sql +=
      " AND status = ?";

    bindings.push(status);

  }


  if (keyword) {

    sql +=
      " AND (" +
      "title LIKE ? " +
      "OR description LIKE ?" +
      ")";

    bindings.push(
      "%" + keyword + "%"
    );

    bindings.push(
      "%" + keyword + "%"
    );

  }


  sql +=
    " ORDER BY start_at ASC, id ASC";


  var statement =
    env.DB.prepare(sql);


  if (bindings.length > 0) {

    statement =
      statement.bind.apply(
        statement,
        bindings
      );

  }


  var result =
    await statement.all();


  return jsonResponse(
    {
      success: true,
      data: result.results || []
    }
  );

}


/* =========================================================
   SINGLE TOURNAMENT
========================================================= */

async function getTournament(
  tournamentId,
  env
) {

  if (
    !isPositiveInteger(
      tournamentId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_TOURNAMENT_ID"
      },
      400
    );

  }


  var tournament =
    await env.DB.prepare(
      "SELECT " +
      "id, " +
      "tournament_code, " +
      "title, " +
      "tournament_type, " +
      "description, " +
      "cover_image_url, " +
      "location, " +
      "start_at, " +
      "end_at, " +
      "registration_start_at, " +
      "registration_end_at, " +
      "max_players, " +
      "max_teams, " +
      "entry_fee, " +
      "status " +
      "FROM tournaments " +
      "WHERE id = ?"
    )
    .bind(
      Number(tournamentId)
    )
    .first();


  if (!tournament) {

    return jsonResponse(
      {
        success: false,
        error: "TOURNAMENT_NOT_FOUND"
      },
      404
    );

  }


  return jsonResponse(
    {
      success: true,
      data: tournament
    }
  );

}


/* =========================================================
   LEAGUE
========================================================= */

async function getLeague(env) {

  var result =
    await env.DB.prepare(
      "SELECT " +
      "lm.id, " +
      "lm.tournament_id, " +
      "lm.round_number, " +
      "lm.match_number, " +
      "lm.scheduled_at, " +
      "lm.score_a, " +
      "lm.score_b, " +
      "lm.status, " +
      "lm.field_name, " +
      "lm.note, " +

      "ta.id AS team_a_id, " +
      "ta.team_name AS team_a_name, " +
      "ta.team_logo_url AS team_a_logo, " +

      "tb.id AS team_b_id, " +
      "tb.team_name AS team_b_name, " +
      "tb.team_logo_url AS team_b_logo, " +

      "tw.id AS winner_team_id, " +
      "tw.team_name AS winner_team_name " +

      "FROM league_matches lm " +

      "LEFT JOIN teams ta " +
      "ON lm.team_a_id = ta.id " +

      "LEFT JOIN teams tb " +
      "ON lm.team_b_id = tb.id " +

      "LEFT JOIN teams tw " +
      "ON lm.winner_team_id = tw.id " +

      "ORDER BY lm.scheduled_at ASC, lm.id ASC"
    )
    .all();


  return jsonResponse(
    {
      success: true,
      data: result.results || []
    }
  );

}


/* =========================================================
   SINGLE LEAGUE MATCH
========================================================= */

async function getLeagueMatch(
  matchId,
  env
) {

  if (
    !isPositiveInteger(
      matchId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_MATCH_ID"
      },
      400
    );

  }


  var match =
    await env.DB.prepare(
      "SELECT " +

      "lm.id, " +
      "lm.tournament_id, " +
      "lm.round_number, " +
      "lm.match_number, " +
      "lm.scheduled_at, " +
      "lm.score_a, " +
      "lm.score_b, " +
      "lm.status, " +
      "lm.field_name, " +
      "lm.note, " +

      "ta.id AS team_a_id, " +
      "ta.team_name AS team_a_name, " +
      "ta.team_logo_url AS team_a_logo, " +

      "tb.id AS team_b_id, " +
      "tb.team_name AS team_b_name, " +
      "tb.team_logo_url AS team_b_logo, " +

      "tw.id AS winner_team_id, " +
      "tw.team_name AS winner_team_name " +

      "FROM league_matches lm " +

      "LEFT JOIN teams ta " +
      "ON lm.team_a_id = ta.id " +

      "LEFT JOIN teams tb " +
      "ON lm.team_b_id = tb.id " +

      "LEFT JOIN teams tw " +
      "ON lm.winner_team_id = tw.id " +

      "WHERE lm.id = ?"
    )
    .bind(
      Number(matchId)
    )
    .first();


  if (!match) {

    return jsonResponse(
      {
        success: false,
        error: "MATCH_NOT_FOUND"
      },
      404
    );

  }


  return jsonResponse(
    {
      success: true,
      data: match
    }
  );

}


/* =========================================================
   RANKING
========================================================= */

async function getRanking(
  request,
  env
) {

  var url =
    new URL(request.url);

  var season =
    url.searchParams.get(
      "season"
    );


  if (!season) {

    season =
      "2026 Season 01";

  }


  var result =
    await env.DB.prepare(
      "SELECT " +

      "pr.id, " +
      "pr.season_name, " +
      "pr.rank_number, " +
      "pr.win_count, " +
      "pr.upper_count, " +
      "pr.points, " +

      "p.id AS player_id, " +
      "p.player_name, " +
      "p.nickname, " +
      "p.avatar_url, " +

      "t.id AS team_id, " +
      "t.team_name, " +
      "t.team_logo_url " +

      "FROM player_ranking pr " +

      "INNER JOIN players p " +
      "ON pr.player_id = p.id " +

      "LEFT JOIN teams t " +
      "ON p.team_id = t.id " +

      "WHERE pr.season_name = ? " +

      "ORDER BY pr.rank_number ASC " +

      "LIMIT 10"
    )
    .bind(season)
    .all();


  return jsonResponse(
    {
      success: true,
      season: season,
      data: result.results || []
    }
  );

}


/* =========================================================
   CONTACT
========================================================= */

async function createContact(
  request,
  env
) {

  var body =
    await parseJsonBody(
      request
    );


  if (!body) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_JSON"
      },
      400
    );

  }


  var name =
    cleanText(
      body.name
    );

  var contact =
    cleanText(
      body.contact
    );

  var message =
    cleanText(
      body.message
    );


  if (!message) {

    return jsonResponse(
      {
        success: false,
        error: "MESSAGE_REQUIRED"
      },
      400
    );

  }


  if (
    message.length > 5000
  ) {

    return jsonResponse(
      {
        success: false,
        error: "MESSAGE_TOO_LONG"
      },
      400
    );

  }


  var result =
    await env.DB.prepare(
      "INSERT INTO contact_messages " +
      "(" +
      "name, " +
      "contact, " +
      "message" +
      ") " +
      "VALUES (?, ?, ?)"
    )
    .bind(
      name || null,
      contact || null,
      message
    )
    .run();


  return jsonResponse(
    {
      success: true,
      id: result.meta.last_row_id
    },
    201
  );

}


/* =========================================================
   REGISTRATION
========================================================= */

async function createRegistration(
  request,
  env
) {

  var body =
    await parseJsonBody(
      request
    );


  if (!body) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_JSON"
      },
      400
    );

  }


  var tournamentId =
    Number(
      body.tournament_id
    );


  var userId =
    Number(
      body.user_id
    );


  var registrationName =
    cleanText(
      body.registration_name
    );


  var registrationType =
    cleanText(
      body.registration_type
    ) ||
    "solo";


  var teamId =
    body.team_id
      ? Number(body.team_id)
      : null;


  /* -------------------------------------------------------
     Validation
  ------------------------------------------------------- */

  if (
    !isPositiveInteger(
      tournamentId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_TOURNAMENT_ID"
      },
      400
    );

  }


  if (
    !isPositiveInteger(
      userId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        error: "INVALID_USER_ID"
      },
      400
    );

  }


  if (!registrationName) {

    return jsonResponse(
      {
        success: false,
        error: "REGISTRATION_NAME_REQUIRED"
      },
      400
    );

  }


  /* -------------------------------------------------------
     Check tournament
  ------------------------------------------------------- */

  var tournament =
    await env.DB.prepare(
      "SELECT " +
      "id, " +
      "status, " +
      "registration_start_at, " +
      "registration_end_at " +
      "FROM tournaments " +
      "WHERE id = ?"
    )
    .bind(
      tournamentId
    )
    .first();


  if (!tournament) {

    return jsonResponse(
      {
        success: false,
        error: "TOURNAMENT_NOT_FOUND"
      },
      404
    );

  }


  if (
    tournament.status !==
    "open"
  ) {

    return jsonResponse(
      {
        success: false,
        error: "REGISTRATION_NOT_OPEN"
      },
      400
    );

  }


  /* -------------------------------------------------------
     Check duplicate registration
  ------------------------------------------------------- */

  var existing =
    await env.DB.prepare(
      "SELECT id " +
      "FROM tournament_registrations " +
      "WHERE tournament_id = ? " +
      "AND user_id = ?"
    )
    .bind(
      tournamentId,
      userId
    )
    .first();


  if (existing) {

    return jsonResponse(
      {
        success: false,
        error: "ALREADY_REGISTERED",
        registration_id:
          existing.id
      },
      409
    );

  }


  /* -------------------------------------------------------
     Create registration
  ------------------------------------------------------- */

  var result =
    await env.DB.prepare(
      "INSERT INTO tournament_registrations " +
      "(" +
      "tournament_id, " +
      "user_id, " +
      "team_id, " +
      "registration_name, " +
      "registration_type, " +
      "status, " +
      "payment_status" +
      ") " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      tournamentId,
      userId,
      teamId,
      registrationName,
      registrationType,
      "pending",
      "unpaid"
    )
    .run();


  return jsonResponse(
    {
      success: true,
      registration_id:
        result.meta.last_row_id,
      status: "pending",
      payment_status: "unpaid"
    },
    201
  );

}


/* =========================================================
   HELPERS
========================================================= */

async function parseJsonBody(
  request
) {

  try {

    return await request.json();

  } catch (error) {

    return null;

  }

}


function cleanText(
  value
) {

  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }


  return String(
    value
  ).trim();

}


function isPositiveInteger(
  value
) {

  var number =
    Number(value);


  return (
    Number.isInteger(number) &&
    number > 0
  );

}