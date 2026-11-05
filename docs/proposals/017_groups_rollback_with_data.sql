-- ROLLBACK THAT DESTROYS GROUP DATA for the proposed 017_groups migration, revision 2.
-- Use ONLY after: (1) the app is stopped, (2) a backup was made with `npm run backup` and verified (PRAGMA integrity_check = ok on the copy),
-- (3) the owner decided that every group, membership, message, mention, group note and group event may be deleted.
-- Run inside a transaction. Everything outside the group tables is untouched. To get the group data back, restore the backup (proposal section 5).
DROP TABLE group_events;
DROP TABLE group_memory;
DROP TABLE group_message_mentions;
DROP TABLE group_messages_fts;
DROP TABLE group_messages;
DROP TABLE group_members;
DROP TABLE bot_groups;
DELETE FROM schema_migrations WHERE version = '017_groups.sql';
