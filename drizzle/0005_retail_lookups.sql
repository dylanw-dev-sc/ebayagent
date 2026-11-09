CREATE TABLE `retail_lookup_usage` (
	`month` text PRIMARY KEY NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retail_lookups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_key` text NOT NULL,
	`brand_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`garment_type` text NOT NULL,
	`material_key` text,
	`query` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`typical_minor` integer,
	`min_minor` integer,
	`max_minor` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`message` text,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_lookups_product_key_unique` ON `retail_lookups` (`product_key`);--> statement-breakpoint
CREATE INDEX `retail_lookups_brand_category_idx` ON `retail_lookups` (`brand_id`,`category_id`);