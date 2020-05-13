/*
 * SQL model for Arosenius.
 *
 * WARNING: Executing this will drop existing data.
 */

DROP TABLE IF EXISTS `artwork`;
CREATE TABLE `artwork` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `title` varchar(200) NOT NULL,
  `description` text
);
