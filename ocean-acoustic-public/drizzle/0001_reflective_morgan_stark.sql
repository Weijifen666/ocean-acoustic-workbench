CREATE TABLE `cloud_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_visitors_updated` ON `cloud_visitors` (`updated`);