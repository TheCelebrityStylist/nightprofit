CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`measured_minor` integer,
	`comparison_minor` integer,
	`evidence_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`correlation_id` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `close_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`closing_session_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closing_session_id`) REFERENCES `closing_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `close_snapshots_hash_unique` ON `close_snapshots` (`hash`);--> statement-breakpoint
CREATE TABLE `closing_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text NOT NULL,
	`trading_date` text NOT NULL,
	`status` text NOT NULL,
	`expected_minor` integer DEFAULT 0 NOT NULL,
	`accounted_minor` integer DEFAULT 0 NOT NULL,
	`submitted_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `close_venue_date` ON `closing_sessions` (`venue_id`,`trading_date`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` integer NOT NULL,
	`attendance` integer,
	`revenue_minor` integer DEFAULT 0 NOT NULL,
	`direct_cost_minor` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text,
	`job_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_idempotency_key_unique` ON `job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `organisation_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_org_email` ON `organisation_members` (`organisation_id`,`email`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`locale` text DEFAULT 'nl-NL' NOT NULL,
	`timezone` text DEFAULT 'Europe/Amsterdam' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_cost_history` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`product_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`source_invoice_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`category` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`venue_id` text,
	`file_key` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text NOT NULL,
	`total_minor` integer,
	`extraction_json` text,
	`confirmed_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`trading_cutoff_minutes` integer DEFAULT 360 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
