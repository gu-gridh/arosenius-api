/*
 * SQL model for Arosenius.
 *
 * WARNING: Executing this will drop existing data.
 */

/* Drop child tables before parent tables to respect foreign key constraints. */
DROP TABLE IF EXISTS `exhibition`;
DROP TABLE IF EXISTS `image`;
DROP TABLE IF EXISTS `keyword`;
DROP TABLE IF EXISTS `artwork`;
DROP TABLE IF EXISTS `person`;

CREATE TABLE `person` (
  `id` INT(3) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(200) NOT NULL,
  `birth_year` VARCHAR(4),
  `death_year` VARCHAR(4),
  UNIQUE KEY (`name`)
);

CREATE TABLE `artwork` (
  `id` INT(6) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `insert_id` INT(6),
  `name` VARCHAR(20),
  `title` VARCHAR(200),
  `title_en` VARCHAR(200),
  `subtitle` VARCHAR(200),
  `deleted` BOOLEAN NOT NULL,
  `published` BOOLEAN NOT NULL,
  `museum_int_id` VARCHAR(100),
  `description` TEXT,
  `museum` VARCHAR(100),
  `museum_url` VARCHAR(300),
  `date_human` VARCHAR(20),
  `date` VARCHAR(10), -- Using the DATE type for unspecific dates would require certain server configuration.
  `size` VARCHAR(200), -- JSON
  `technique_material` VARCHAR(200),
  `acquisition` VARCHAR(200),
  `content` TEXT,
  `inscription` TEXT,
  `material` VARCHAR(300),
  `creator` VARCHAR(100),
  `signature` VARCHAR(200),
  `sender` INT(3) UNSIGNED,
  `recipient` INT(3) UNSIGNED,
  `literature` VARCHAR(300),
  `reproductions` VARCHAR(300),
  `bundle` VARCHAR(50),
  FOREIGN KEY (`sender`) REFERENCES `person` (`id`),
  FOREIGN KEY (`recipient`) REFERENCES `person` (`id`),
  UNIQUE KEY (`name`)
);

CREATE TABLE `keyword` (
  `id` INT(7) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `artwork` INT(6) UNSIGNED NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  FOREIGN KEY (`artwork`) REFERENCES `artwork` (`id`),
  UNIQUE KEY (`artwork`, `type`, `name`),
  KEY (`type`, `name`) -- also includes index on only `type`
);

CREATE TABLE `image` (
  `id` INT(6) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `artwork` INT(6) UNSIGNED NOT NULL,
  `filename` VARCHAR(100) NOT NULL,
  `type` VARCHAR(10),
  `width` INT(5) NOT NULL,
  `height` INT(5) NOT NULL,
  `page` INT(1),
  `pageid` VARCHAR(20),
  `order` INT(1),
  `side` VARCHAR(20),
  `color` VARCHAR(50),
  FOREIGN KEY (`artwork`) REFERENCES `artwork` (`id`)
);

CREATE TABLE `exhibition` (
  `id` INT(3) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `artwork` INT(6) UNSIGNED NOT NULL,
  `location` VARCHAR(100) NOT NULL,
  `year` INT(4) NOT NULL,
  FOREIGN KEY (`artwork`) REFERENCES `artwork` (`id`),
  UNIQUE KEY (`artwork`, `location`, `year`)
)
