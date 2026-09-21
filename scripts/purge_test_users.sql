-- =====================================================================
-- DATABASE CLEANUP SCRIPT: PURGE TEST USER & PATIENT DATA
-- Project: baootqatwkhxnkpxeuht
-- Preserves: Schema, Tables, Policies, Functions, Triggers, Storage
-- =====================================================================

BEGIN;

-- 1. Purge child alert history logs
DELETE FROM public.alert_history;

-- 2. Purge child reminder delivery logs
DELETE FROM public.reminder_send_logs;

-- 3. Purge child scheduled reminder events
DELETE FROM public.reminder_events;

-- 4. Purge child medicine adherence logs
DELETE FROM public.medicine_logs;

-- 5. Purge child health metrics (steps, heart rate, sleep)
DELETE FROM public.health_data;

-- 6. Purge child family member contacts
DELETE FROM public.family_members;

-- 7. Purge prescriptions / medicines
DELETE FROM public.medicines;

-- 8. Purge patient profiles (linked to auth.users)
DELETE FROM public.patients;

-- 9. (Optional for direct Postgres admin / SQL Editor):
-- To also purge all auth accounts directly from PostgreSQL:
DELETE FROM auth.users;

-- Verification check: Verify all counts are now 0
SELECT 'patients' AS table_name, count(*) AS remaining FROM public.patients
UNION ALL
SELECT 'medicines', count(*) FROM public.medicines
UNION ALL
SELECT 'medicine_logs', count(*) FROM public.medicine_logs
UNION ALL
SELECT 'reminder_events', count(*) FROM public.reminder_events
UNION ALL
SELECT 'family_members', count(*) FROM public.family_members
UNION ALL
SELECT 'health_data', count(*) FROM public.health_data
UNION ALL
SELECT 'alert_history', count(*) FROM public.alert_history
UNION ALL
SELECT 'reminder_send_logs', count(*) FROM public.reminder_send_logs
UNION ALL
SELECT 'auth.users', count(*) FROM auth.users;

COMMIT;
