ALTER TABLE `listings` ADD `description_text` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `skipped_old` integer DEFAULT 0 NOT NULL;