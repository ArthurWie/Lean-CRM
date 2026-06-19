CREATE TABLE `firmen` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`fn` text,
	`branche` text,
	`groesse` text,
	`status` text DEFAULT 'Neu' NOT NULL,
	`heiss` integer DEFAULT false NOT NULL,
	`website` text,
	`lessons` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `followups` (
	`id` text PRIMARY KEY NOT NULL,
	`firma_id` text NOT NULL,
	`faellig_am` text NOT NULL,
	`grund` text,
	`erledigt` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`firma_id`) REFERENCES `firmen`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interaktionen` (
	`id` text PRIMARY KEY NOT NULL,
	`firma_id` text NOT NULL,
	`kontakt_id` text,
	`datum` text NOT NULL,
	`kanal` text,
	`outcome` text,
	`notiz` text,
	`bearbeiter` text DEFAULT 'Arthur' NOT NULL,
	FOREIGN KEY (`firma_id`) REFERENCES `firmen`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kontakt_id`) REFERENCES `kontakte`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kontakt_mails` (
	`id` text PRIMARY KEY NOT NULL,
	`kontakt_id` text NOT NULL,
	`email` text NOT NULL,
	FOREIGN KEY (`kontakt_id`) REFERENCES `kontakte`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kontakte` (
	`id` text PRIMARY KEY NOT NULL,
	`firma_id` text NOT NULL,
	`name` text,
	`rolle` text,
	`telefon` text,
	`linkedin` text,
	`li_angenommen` integer DEFAULT false NOT NULL,
	`relevant` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`firma_id`) REFERENCES `firmen`(`id`) ON UPDATE no action ON DELETE no action
);
