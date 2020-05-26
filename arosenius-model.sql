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
  `museum_int_id` varchar(100),
  `description` text,
  `museum` varchar(100),
  `archive_physloc` varchar(50),
  `archive_title` varchar(100),
  `date` varchar(30),
  `item_date_str` varchar(50),
  `bundle` varchar(50),
  `date_to` varchar(20)
);

DROP TABLE IF EXISTS `keyword`;
CREATE TABLE `keyword` (
	`id` int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
	`artwork` int(10) unsigned NOT NULL,
	`type` varchar(50) NOT NULL,
	`name` varchar(50) NOT NULL,
	KEY (artwork, type, name)
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
  `side` varchar(20),
  KEY (`filename`)
);
