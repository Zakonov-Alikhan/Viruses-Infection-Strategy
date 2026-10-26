CREATE TABLE IF NOT EXISTS cw_accounts (
  id uuid PRIMARY KEY,
  username varchar(24) NOT NULL,
  username_normalized varchar(24) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  rating integer NOT NULL DEFAULT 1200,
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cw_sessions (
  token_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES cw_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cw_sessions_account_id_idx ON cw_sessions(account_id);
CREATE INDEX IF NOT EXISTS cw_sessions_expires_at_idx ON cw_sessions(expires_at);

CREATE TABLE IF NOT EXISTS cw_rated_matches (
  match_id varchar(64) PRIMARY KEY,
  winner_id uuid NOT NULL REFERENCES cw_accounts(id),
  loser_id uuid NOT NULL REFERENCES cw_accounts(id),
  winner_rating_before integer NOT NULL,
  loser_rating_before integer NOT NULL,
  rating_delta integer NOT NULL CHECK (rating_delta >= 0),
  finished_at timestamptz NOT NULL DEFAULT now(),
  CHECK (winner_id <> loser_id)
);
CREATE INDEX IF NOT EXISTS cw_rated_matches_winner_idx ON cw_rated_matches(winner_id);
CREATE INDEX IF NOT EXISTS cw_rated_matches_loser_idx ON cw_rated_matches(loser_id);
