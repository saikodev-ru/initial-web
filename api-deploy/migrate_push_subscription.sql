-- Web Push: add push_subscription column to users table
-- Run this on your MySQL database:
--   mysql -u your_user -p your_database < migrate_push_subscription.sql

ALTER TABLE `users` 
  ADD COLUMN `push_subscription` TEXT NULL AFTER `fcm_token`;
