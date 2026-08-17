CREATE TABLE `dashboardUsers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` enum('admin','operator') NOT NULL DEFAULT 'operator',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp,
	CONSTRAINT `dashboardUsers_id` PRIMARY KEY(`id`),
	CONSTRAINT `dashboardUsers_username_unique` UNIQUE(`username`)
);
