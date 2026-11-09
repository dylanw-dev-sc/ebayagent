CREATE TABLE `colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`priority` text DEFAULT 'neutral' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `colors_key_unique` ON `colors` (`key`);--> statement-breakpoint
ALTER TABLE `listing_evaluations` ADD `color_keys` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `listing_evaluations` ADD `color_summary` text;--> statement-breakpoint
ALTER TABLE `listing_evaluations` ADD `color_score` real DEFAULT 0 NOT NULL;