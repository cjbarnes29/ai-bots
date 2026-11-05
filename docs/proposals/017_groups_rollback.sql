-- ROLLBACK (SAFE) for the proposed 017_groups migration, revision 2. Run ONLY inside a transaction, ONLY on the owner's instruction,
-- ONLY with the app stopped.
--
-- It REFUSES to run while any group data exists (any group, membership, message, mention, note or event): the first INSERT below fails with
--   "CHECK constraint failed: group_rows_must_be_zero__take_a_backup_and_use_the_with_data_script"
-- and, inside the transaction, nothing is changed. Group data is only ever removed by 017_groups_rollback_with_data.sql, after a verified backup.
-- If the migration was never applied this fails on the first SELECT (no such table) and changes nothing.
CREATE TEMP TABLE awp_rollback_guard (group_rows_must_be_zero__take_a_backup_and_use_the_with_data_script INTEGER NOT NULL
  CHECK (group_rows_must_be_zero__take_a_backup_and_use_the_with_data_script = 0));
INSERT INTO awp_rollback_guard SELECT
  (SELECT COUNT(*) FROM bot_groups) + (SELECT COUNT(*) FROM group_members) + (SELECT COUNT(*) FROM group_messages)
  + (SELECT COUNT(*) FROM group_message_mentions) + (SELECT COUNT(*) FROM group_memory) + (SELECT COUNT(*) FROM group_events);
DROP TABLE awp_rollback_guard;
-- children before parents; dropping a table also drops its indexes and triggers (DROP does not fire the no-delete triggers)
DROP TABLE group_events;
DROP TABLE group_memory;
DROP TABLE group_message_mentions;
DROP TABLE group_messages_fts;
DROP TABLE group_messages;
DROP TABLE group_members;
DROP TABLE bot_groups;
DELETE FROM schema_migrations WHERE version = '017_groups.sql';
