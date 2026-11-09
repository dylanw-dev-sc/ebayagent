ALTER TABLE `categories` ADD `measurement_ranges` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `skipped_seller` integer DEFAULT 0 NOT NULL;