
-- Schedule reminder-cron to run every minute
SELECT cron.schedule(
  'reminder-cron-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://baootqatwkhxnkpxeuht.supabase.co/functions/v1/reminder-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhb290cWF0d2toeG5rcHhldWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTEzMTgsImV4cCI6MjA5MTQ2NzMxOH0.vzEB39kvMqbmoxgoWYwnDQjl_XvvSaW8I9KFC1A7rnI"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- Schedule escalation-check to run every minute
SELECT cron.schedule(
  'escalation-check-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://baootqatwkhxnkpxeuht.supabase.co/functions/v1/escalation-check',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhb290cWF0d2toeG5rcHhldWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTEzMTgsImV4cCI6MjA5MTQ2NzMxOH0.vzEB39kvMqbmoxgoWYwnDQjl_XvvSaW8I9KFC1A7rnI"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
