CREATE TABLE `cloud_chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`request_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`ciphertext` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_chat_runs_owner_request` ON `cloud_chat_runs` (`visitor_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `cloud_chat_runs_owner_state` ON `cloud_chat_runs` (`visitor_id`,`conversation_id`,`state`,`updated`);--> statement-breakpoint
CREATE TABLE `cloud_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`migrated` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_conversations_owner_updated` ON `cloud_conversations` (`visitor_id`,`updated`);--> statement-breakpoint
CREATE TABLE `cloud_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`ciphertext` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_messages_conversation_created` ON `cloud_messages` (`visitor_id`,`conversation_id`,`created`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_messages_run_ordinal` ON `cloud_messages` (`run_id`,`ordinal`);