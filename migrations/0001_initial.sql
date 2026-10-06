
/* =========================================================
   OURSPACE
   Initial Database Migration
   Cloudflare D1 / SQLite
========================================================= */


/* =========================================================
   01. USERS
   會員 / LINE 帳號
========================================================= */

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    line_user_id TEXT UNIQUE,

    display_name TEXT NOT NULL,

    avatar_url TEXT,

    email TEXT,

    phone TEXT,

    role TEXT NOT NULL DEFAULT 'user',

    status TEXT NOT NULL DEFAULT 'active',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   02. TEAMS
   戰隊
========================================================= */

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    team_code TEXT UNIQUE,

    team_name TEXT NOT NULL,

    team_logo_url TEXT,

    description TEXT,

    captain_user_id INTEGER,

    status TEXT NOT NULL DEFAULT 'active',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        captain_user_id
    )
    REFERENCES users(id)
);


/* =========================================================
   03. TEAM MEMBERS
   戰隊成員
========================================================= */

CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    team_id INTEGER NOT NULL,

    user_id INTEGER NOT NULL,

    member_role TEXT NOT NULL DEFAULT 'member',

    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    left_at TEXT,

    status TEXT NOT NULL DEFAULT 'active',

    UNIQUE (
        team_id,
        user_id
    ),

    FOREIGN KEY (
        team_id
    )
    REFERENCES teams(id),

    FOREIGN KEY (
        user_id
    )
    REFERENCES users(id)
);


/* =========================================================
   04. NEWS
   最新消息
========================================================= */

CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    title TEXT NOT NULL,

    summary TEXT,

    content TEXT,

    cover_image_url TEXT,

    category TEXT NOT NULL DEFAULT 'news',

    status TEXT NOT NULL DEFAULT 'published',

    sort_order INTEGER NOT NULL DEFAULT 0,

    published_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   05. NEWS IMAGES
   首頁照片輪播
========================================================= */

CREATE TABLE IF NOT EXISTS news_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    image_url TEXT NOT NULL,

    title TEXT,

    subtitle TEXT,

    link_url TEXT,

    sort_order INTEGER NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'active',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   06. TOURNAMENTS
   賽事
========================================================= */

CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    tournament_code TEXT UNIQUE,

    title TEXT NOT NULL,

    tournament_type TEXT NOT NULL,

    description TEXT,

    cover_image_url TEXT,

    location TEXT,

    start_at TEXT,

    end_at TEXT,

    registration_start_at TEXT,

    registration_end_at TEXT,

    max_players INTEGER,

    max_teams INTEGER,

    entry_fee INTEGER NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'draft',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   07. TOURNAMENT REGISTRATIONS
   賽事報名
========================================================= */

CREATE TABLE IF NOT EXISTS tournament_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    tournament_id INTEGER NOT NULL,

    user_id INTEGER NOT NULL,

    team_id INTEGER,

    registration_name TEXT NOT NULL,

    registration_type TEXT NOT NULL DEFAULT 'solo',

    status TEXT NOT NULL DEFAULT 'pending',

    payment_status TEXT NOT NULL DEFAULT 'unpaid',

    payment_id INTEGER,

    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    cancelled_at TEXT,

    UNIQUE (
        tournament_id,
        user_id
    ),

    FOREIGN KEY (
        tournament_id
    )
    REFERENCES tournaments(id),

    FOREIGN KEY (
        user_id
    )
    REFERENCES users(id),

    FOREIGN KEY (
        team_id
    )
    REFERENCES teams(id)
);


/* =========================================================
   08. LEAGUE MATCHES
   戰隊聯賽賽程
========================================================= */

CREATE TABLE IF NOT EXISTS league_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    tournament_id INTEGER NOT NULL,

    round_number INTEGER,

    match_number INTEGER,

    scheduled_at TEXT NOT NULL,

    team_a_id INTEGER,

    team_b_id INTEGER,

    score_a INTEGER,

    score_b INTEGER,

    status TEXT NOT NULL DEFAULT 'scheduled',

    winner_team_id INTEGER,

    field_name TEXT,

    note TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        tournament_id
    )
    REFERENCES tournaments(id),

    FOREIGN KEY (
        team_a_id
    )
    REFERENCES teams(id),

    FOREIGN KEY (
        team_b_id
    )
    REFERENCES teams(id),

    FOREIGN KEY (
        winner_team_id
    )
    REFERENCES teams(id)
);


/* =========================================================
   09. PLAYERS
   個人參賽者
========================================================= */

CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER,

    player_name TEXT NOT NULL,

    nickname TEXT,

    avatar_url TEXT,

    team_id INTEGER,

    status TEXT NOT NULL DEFAULT 'active',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        user_id
    )
    REFERENCES users(id),

    FOREIGN KEY (
        team_id
    )
    REFERENCES teams(id)
);


/* =========================================================
   10. PLAYER RANKING
   陀螺爭霸排行榜
========================================================= */

CREATE TABLE IF NOT EXISTS player_ranking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    player_id INTEGER NOT NULL,

    season_name TEXT NOT NULL,

    rank_number INTEGER NOT NULL,

    win_count INTEGER NOT NULL DEFAULT 0,

    upper_count INTEGER NOT NULL DEFAULT 0,

    points INTEGER NOT NULL DEFAULT 0,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        player_id,
        season_name
    ),

    FOREIGN KEY (
        player_id
    )
    REFERENCES players(id)
);


/* =========================================================
   11. TOURNAMENT RESULTS
   賽事成績
========================================================= */

CREATE TABLE IF NOT EXISTS tournament_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    tournament_id INTEGER NOT NULL,

    player_id INTEGER,

    team_id INTEGER,

    final_rank INTEGER,

    points INTEGER NOT NULL DEFAULT 0,

    result_status TEXT NOT NULL DEFAULT 'finished',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        tournament_id
    )
    REFERENCES tournaments(id),

    FOREIGN KEY (
        player_id
    )
    REFERENCES players(id),

    FOREIGN KEY (
        team_id
    )
    REFERENCES teams(id)
);


/* =========================================================
   12. PAYMENTS
   金流紀錄
========================================================= */

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER,

    tournament_id INTEGER,

    registration_id INTEGER,

    payment_provider TEXT,

    merchant_trade_no TEXT UNIQUE,

    provider_trade_no TEXT,

    amount INTEGER NOT NULL DEFAULT 0,

    currency TEXT NOT NULL DEFAULT 'TWD',

    payment_method TEXT,

    status TEXT NOT NULL DEFAULT 'pending',

    paid_at TEXT,

    raw_response TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        user_id
    )
    REFERENCES users(id),

    FOREIGN KEY (
        tournament_id
    )
    REFERENCES tournaments(id),

    FOREIGN KEY (
        registration_id
    )
    REFERENCES tournament_registrations(id)
);


/* =========================================================
   13. CONTACT MESSAGES
   聯絡我們
========================================================= */

CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER,

    name TEXT,

    contact TEXT,

    message TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'unread',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        user_id
    )
    REFERENCES users(id)
);


/* =========================================================
   14. INDEXES
========================================================= */


/* Users */

CREATE INDEX IF NOT EXISTS idx_users_line_user_id
ON users(line_user_id);


/* Teams */

CREATE INDEX IF NOT EXISTS idx_teams_status
ON teams(status);


/* Team members */

CREATE INDEX IF NOT EXISTS idx_team_members_team
ON team_members(team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user
ON team_members(user_id);


/* News */

CREATE INDEX IF NOT EXISTS idx_news_status
ON news(status);

CREATE INDEX IF NOT EXISTS idx_news_published_at
ON news(published_at);

CREATE INDEX IF NOT EXISTS idx_news_sort
ON news(sort_order);


/* News images */

CREATE INDEX IF NOT EXISTS idx_news_images_sort
ON news_images(sort_order);


/* Tournaments */

CREATE INDEX IF NOT EXISTS idx_tournaments_status
ON tournaments(status);

CREATE INDEX IF NOT EXISTS idx_tournaments_start_at
ON tournaments(start_at);

CREATE INDEX IF NOT EXISTS idx_tournaments_type
ON tournaments(tournament_type);


/* Tournament registrations */

CREATE INDEX IF NOT EXISTS idx_registrations_tournament
ON tournament_registrations(tournament_id);

CREATE INDEX IF NOT EXISTS idx_registrations_user
ON tournament_registrations(user_id);

CREATE INDEX IF NOT EXISTS idx_registrations_status
ON tournament_registrations(status);


/* League */

CREATE INDEX IF NOT EXISTS idx_league_matches_tournament
ON league_matches(tournament_id);

CREATE INDEX IF NOT EXISTS idx_league_matches_schedule
ON league_matches(scheduled_at);

CREATE INDEX IF NOT EXISTS idx_league_matches_status
ON league_matches(status);


/* Players */

CREATE INDEX IF NOT EXISTS idx_players_user
ON players(user_id);

CREATE INDEX IF NOT EXISTS idx_players_team
ON players(team_id);


/* Ranking */

CREATE INDEX IF NOT EXISTS idx_player_ranking_season
ON player_ranking(season_name);

CREATE INDEX IF NOT EXISTS idx_player_ranking_rank
ON player_ranking(
    season_name,
    rank_number
);


/* Results */

CREATE INDEX IF NOT EXISTS idx_results_tournament
ON tournament_results(tournament_id);


/* Payments */

CREATE INDEX IF NOT EXISTS idx_payments_user
ON payments(user_id);

CREATE INDEX IF NOT EXISTS idx_payments_tournament
ON payments(tournament_id);

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status);

CREATE INDEX IF NOT EXISTS idx_payments_merchant_trade_no
ON payments(merchant_trade_no);


/* Contact */

CREATE INDEX IF NOT EXISTS idx_contact_status
ON contact_messages(status);

CREATE INDEX IF NOT EXISTS idx_contact_created
ON contact_messages(created_at);
