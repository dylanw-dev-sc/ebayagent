CREATE TABLE `brand_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_aliases_normalized_unique` ON `brand_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `brand_aliases_brand_idx` ON `brand_aliases` (`brand_id`);--> statement-breakpoint
CREATE TABLE `brand_group_members` (
	`brand_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`brand_id`, `group_id`),
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `brand_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_groups_name_unique` ON `brand_groups` (`name`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`search_query` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`exclude_phrases` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized_name_unique` ON `brands` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`noun` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`size_system` text DEFAULT 'alpha' NOT NULL,
	`accepted_sizes` text DEFAULT '[]' NOT NULL,
	`review_sizes` text DEFAULT '[]' NOT NULL,
	`neck_sizes` text DEFAULT '[]' NOT NULL,
	`sleeve_lengths` text DEFAULT '[]' NOT NULL,
	`ebay_category_ids` text DEFAULT '[]' NOT NULL,
	`title_keywords` text DEFAULT '[]' NOT NULL,
	`exclude_keywords` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `conditions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`ebay_condition_ids` text DEFAULT '[]' NOT NULL,
	`match_terms` text DEFAULT '[]' NOT NULL,
	`accepted` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conditions_key_unique` ON `conditions` (`key`);--> statement-breakpoint
CREATE TABLE `listing_evaluations` (
	`listing_id` integer PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`summary` text NOT NULL,
	`brand_id` integer,
	`brand_status` text NOT NULL,
	`category_id` integer,
	`size_label` text,
	`size_keys` text DEFAULT '[]' NOT NULL,
	`material_keys` text DEFAULT '[]' NOT NULL,
	`material_level` text NOT NULL,
	`material_summary` text NOT NULL,
	`material_score` real DEFAULT 0 NOT NULL,
	`condition_key` text,
	`condition_label` text,
	`matched_profile_ids` text DEFAULT '[]' NOT NULL,
	`review_profile_ids` text DEFAULT '[]' NOT NULL,
	`facts` text NOT NULL,
	`rules_hash` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listing_evaluations_state_idx` ON `listing_evaluations` (`state`);--> statement-breakpoint
CREATE INDEX `listing_evaluations_brand_idx` ON `listing_evaluations` (`brand_id`);--> statement-breakpoint
CREATE TABLE `listing_profile_matches` (
	`listing_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`state` text NOT NULL,
	`summary` text NOT NULL,
	`reasons` text NOT NULL,
	PRIMARY KEY(`listing_id`, `profile_id`),
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lpm_profile_state_idx` ON `listing_profile_matches` (`profile_id`,`state`);--> statement-breakpoint
CREATE TABLE `listing_user_states` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	`saved_at` integer,
	`dismissed` integer DEFAULT false NOT NULL,
	`dismissed_at` integer,
	`reviewed` integer DEFAULT false NOT NULL,
	`reviewed_at` integer,
	`note` text,
	PRIMARY KEY(`source`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`legacy_id` text,
	`title` text NOT NULL,
	`brand_aspect` text,
	`size_aspect` text,
	`material_aspect` text,
	`aspects` text DEFAULT '[]' NOT NULL,
	`ebay_category_ids` text DEFAULT '[]' NOT NULL,
	`ebay_category_path` text,
	`condition_text` text,
	`condition_id` text,
	`price_minor` integer,
	`currency` text,
	`shipping_status` text DEFAULT 'unknown' NOT NULL,
	`shipping_minor` integer,
	`shipping_currency` text,
	`buying_options` text DEFAULT '[]' NOT NULL,
	`image_url` text,
	`additional_images` text DEFAULT '[]' NOT NULL,
	`item_url` text,
	`listed_at` integer,
	`origin_at` integer,
	`query_category_ids` text DEFAULT '[]' NOT NULL,
	`details_fetched_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_source_external_unique` ON `listings` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `listings_last_seen_idx` ON `listings` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `listings_listed_idx` ON `listings` (`listed_at`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'fiber' NOT NULL,
	`priority` text DEFAULT 'neutral' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`components` text DEFAULT '[]' NOT NULL,
	`heavy_threshold_pct` integer,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_key_unique` ON `materials` (`key`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_overrides` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`reference_retail_minor` integer NOT NULL,
	`allowed_bps` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`retail_source` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_decisions` (
	`listing_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`rule_level` text,
	`rule_id` integer,
	`reference_retail_minor` integer,
	`allowed_bps` integer,
	`max_price_minor` integer,
	`item_minor` integer,
	`shipping_minor` integer,
	`total_minor` integer,
	`currency` text NOT NULL,
	`explanation` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pricing_decisions_status_idx` ON `pricing_decisions` (`status`);--> statement-breakpoint
CREATE TABLE `pricing_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`brand_id` integer,
	`reference_retail_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`allowed_bps` integer NOT NULL,
	`retail_source` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pricing_rules_category_idx` ON `pricing_rules` (`category_id`);--> statement-breakpoint
CREATE TABLE `query_states` (
	`query_key` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`watermark_at` integer,
	`last_status` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`heartbeat_at` integer NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`queries_planned` integer DEFAULT 0 NOT NULL,
	`queries_completed` integer DEFAULT 0 NOT NULL,
	`api_calls` integer DEFAULT 0 NOT NULL,
	`detail_calls` integer DEFAULT 0 NOT NULL,
	`examined` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`new_listings` integer DEFAULT 0 NOT NULL,
	`updated_listings` integer DEFAULT 0 NOT NULL,
	`unchanged_listings` integer DEFAULT 0 NOT NULL,
	`matched_new` integer DEFAULT 0 NOT NULL,
	`review_new` integer DEFAULT 0 NOT NULL,
	`rejected_new` integer DEFAULT 0 NOT NULL,
	`purged` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`rate_limited` integer DEFAULT false NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`overrides` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
