CREATE TABLE `event_endorsements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`audience` text NOT NULL,
	`comment` text,
	`activity_report_id` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_report_id`) REFERENCES `activity_reports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_endorsements_user_event_uq` ON `event_endorsements` (`user_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `event_endorsements_event_idx` ON `event_endorsements` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`match_key` text NOT NULL,
	`description` text,
	`watch_count` integer DEFAULT 0 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_series_match_key_idx` ON `event_series` (`match_key`);--> statement-breakpoint
CREATE TABLE `event_tags` (
	`event_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`added_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`event_id`, `tag_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_tags_tag_idx` ON `event_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `series_watches` (
	`user_id` text NOT NULL,
	`series_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `series_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_watches_series_idx` ON `series_watches` (`series_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`facet` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint
ALTER TABLE `events` ADD `series_id` text REFERENCES event_series(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `events` ADD `edition_label` text;--> statement-breakpoint
ALTER TABLE `events` ADD `start_month` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `endorsement_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `events_series_start_idx` ON `events` (`series_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_status_start_month_idx` ON `events` (`status`,`start_month`);--> statement-breakpoint
CREATE INDEX `events_status_endorsement_idx` ON `events` (`status`,`endorsement_count`);--> statement-breakpoint
ALTER TABLE `notification_settings` ADD `new_edition` integer DEFAULT true NOT NULL;