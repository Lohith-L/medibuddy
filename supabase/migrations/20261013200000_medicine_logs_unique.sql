-- One medicine_logs row per dose (medicine + scheduled time), and live updates.
--
-- reminder_events is already unique per (medicine_id, scheduled_date, scheduled_time).
-- medicine_logs had no such guard, so the cron and the alarm's "Taken" could both
-- insert a row for the same dose. This adds the guard.
--
-- Nothing is deleted automatically. If duplicates already exist the migration
-- stops and tells you; the cleanup query at the bottom keeps the best row of
-- each dose (taken > missed > snoozed > pending) and can be run after a backup.

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM (SELECT 1 FROM public.medicine_logs GROUP BY medicine_id, scheduled_time HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'medicine_logs has % doses with more than one row. Run the cleanup query at the end of this file first.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS medicine_logs_one_per_dose
  ON public.medicine_logs (medicine_id, scheduled_time);

-- Live updates for "Today's medicine log" (website + app). Safe to run again.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['medicine_logs', 'reminder_events', 'medicines'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ── Cleanup (only if the check above stopped the migration) ──────────────
-- Back up first. Keeps one row per dose: taken first, then missed, snoozed, pending;
-- among equals the oldest. Then run this whole file again.
--
-- DELETE FROM public.medicine_logs l
-- USING (
--   SELECT id, row_number() OVER (
--            PARTITION BY medicine_id, scheduled_time
--            ORDER BY CASE status WHEN 'taken' THEN 0 WHEN 'missed' THEN 1 WHEN 'snoozed' THEN 2 ELSE 3 END,
--                     created_at, id) AS rn
--   FROM public.medicine_logs
-- ) ranked
-- WHERE l.id = ranked.id AND ranked.rn > 1;
