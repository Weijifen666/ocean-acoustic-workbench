CREATE TABLE `research_workspace_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`author_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_artifacts_workspace_created` ON `research_workspace_artifacts` (`workspace_id`,`created`);--> statement-breakpoint
CREATE TABLE `research_workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`used_by` text,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_invites_token_hash` ON `research_workspace_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `research_invites_workspace_created` ON `research_workspace_invites` (`workspace_id`,`created`);--> statement-breakpoint
CREATE TABLE `research_workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`ciphertext` text NOT NULL,
	`joined_via_invite` text,
	`joined` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_members_workspace_account` ON `research_workspace_members` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `research_members_account_joined` ON `research_workspace_members` (`account_id`,`joined`);--> statement-breakpoint
CREATE TABLE `research_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_workspaces_owner_created` ON `research_workspaces` (`owner_id`,`created`);