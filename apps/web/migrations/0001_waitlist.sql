CREATE TABLE waitlist_subscribers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text NOT NULL UNIQUE CHECK(email=lower(email) AND length(email)<=254),
 consent_version text NOT NULL,
 consented_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE waitlist_rate_limits (
 key text PRIMARY KEY,
 attempts integer NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX waitlist_rate_limits_expiry ON waitlist_rate_limits(expires_at);
