/*
 * SQL model for Arosenius.
 *
 * WARNING: Executing this will drop existing data.
 */

DROP TABLE IF EXISTS `artwork`;
CREATE TABLE `artwork` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `insert_id` int(10),
  `name` varchar(20),
  `title` varchar(200),
  `subtitle` varchar(200),
  `deleted` boolean NOT NULL,
  `published` boolean NOT NULL,
  `museum_int_id` varchar(100),
  `description` text,
  `museum` varchar(100),
  `archive_physloc` varchar(50),
  `archive_title` varchar(100),
  `museum_url` varchar(300),
  `date_human` varchar(20),
  `date` varchar(10), -- Using the DATE type for unspecific dates would require certain server configuration.
  `size` varchar(200), -- JSON
  `acquisition` varchar(200),
  `content` text,
  `inscription` text,
  `material` varchar(300),
  `creator` varchar(100),
  `sender` int(3),
  `recipient` int(3),
  `literature` varchar(300),
  `bundle` varchar(50),
  UNIQUE KEY (`name`)
);

DROP TABLE IF EXISTS `keyword`;
CREATE TABLE `keyword` (
	`id` int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
	`artwork` int(10) unsigned NOT NULL,
	`type` varchar(50) NOT NULL,
	`name` varchar(50) NOT NULL,
	UNIQUE KEY (`artwork`, `type`, `name`)
);

DROP TABLE IF EXISTS `person`;
CREATE TABLE `person` (
  `id` int(3) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(200) NOT NULL,
  `birth_year` VARCHAR(4),
  `death_year` VARCHAR(4),
  UNIQUE KEY (`name`)
);

DROP TABLE IF EXISTS `image`;
CREATE TABLE `image` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `artwork` int(10) unsigned NOT NULL,
  `filename` varchar(100) NOT NULL,
  `type` varchar(10),
  `width` int(5) NOT NULL,
  `height` int(5) NOT NULL,
  `page` int(1),
  `pageid` varchar(20),
  `order` int(1),
  `side` varchar(20)
);

DROP TABLE IF EXISTS `exhibition`;
CREATE TABLE `exhibition` (
  `id` int(3) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `artwork` int(6) UNSIGNED NOT NULL,
  `location` varchar(100) NOT NULL,
  `year` int(4) NOT NULL,
  UNIQUE KEY (`artwork`, `location`, `year`)
)
