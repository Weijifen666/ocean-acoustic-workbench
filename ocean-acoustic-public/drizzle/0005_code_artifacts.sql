CREATE TABLE code_artifacts (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 ciphertext TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX code_artifacts_owner_updated ON code_artifacts(owner_id, updated);
