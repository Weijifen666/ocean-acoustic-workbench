CREATE TABLE cloud_research_sessions (
  visitor_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, id)
);
--> statement-breakpoint
CREATE TABLE cloud_research_runs (
  id TEXT PRIMARY KEY NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  ciphertext TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX research_owner_request ON cloud_research_runs(visitor_id, request_key);
--> statement-breakpoint
CREATE INDEX research_owner_session ON cloud_research_runs(visitor_id, session_id, created);
--> statement-breakpoint
CREATE UNIQUE INDEX research_owner_active ON cloud_research_runs(visitor_id) WHERE state='running';
