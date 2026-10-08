CREATE TABLE `bridge_state` (
	`id` text PRIMARY KEY NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bridge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bridge_requests_state_created` ON `bridge_requests` (`state`,`created`);