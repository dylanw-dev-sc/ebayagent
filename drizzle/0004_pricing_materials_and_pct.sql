PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_overrides` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`reference_retail_minor` integer NOT NULL,
	`allowed_bps` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`retail_source` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source`, `external_id`)
);
--> statement-breakpoint
INSERT INTO `__new_price_overrides`("source", "external_id", "reference_retail_minor", "allowed_bps", "currency", "retail_source", "notes", "created_at") SELECT "source", "external_id", "reference_retail_minor", "allowed_bps", "currency", "retail_source", "notes", "created_at" FROM `price_overrides`;--> statement-breakpoint
DROP TABLE `price_overrides`;--> statement-breakpoint
ALTER TABLE `__new_price_overrides` RENAME TO `price_overrides`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_pricing_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`brand_id` integer,
	`material_key` text,
	`reference_retail_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`allowed_bps` integer,
	`retail_source` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pricing_rules`("id", "category_id", "brand_id", "material_key", "reference_retail_minor", "currency", "allowed_bps", "retail_source", "notes", "active", "created_at", "updated_at") SELECT "id", "category_id", "brand_id", NULL, "reference_retail_minor", "currency", "allowed_bps", "retail_source", "notes", "active", "created_at", "updated_at" FROM `pricing_rules`;--> statement-breakpoint
DROP TABLE `pricing_rules`;--> statement-breakpoint
ALTER TABLE `__new_pricing_rules` RENAME TO `pricing_rules`;--> statement-breakpoint
CREATE INDEX `pricing_rules_category_idx` ON `pricing_rules` (`category_id`);--> statement-breakpoint
ALTER TABLE `pricing_decisions` ADD `uses_default_bps` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pricing_decisions` ADD `pct_of_retail_bps` integer;--> statement-breakpoint
ALTER TABLE `pricing_decisions` ADD `pct_is_lower_bound` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pricing_decisions` ADD `seller_retail_minor` integer;--> statement-breakpoint
ALTER TABLE `pricing_decisions` ADD `retail_lookup_id` integer;--> statement-breakpoint
CREATE INDEX `pricing_decisions_pct_idx` ON `pricing_decisions` (`pct_of_retail_bps`);