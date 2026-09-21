import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://baootqatwkhxnkpxeuht.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required.');
  console.log('You can find your service_role key in: Supabase Dashboard > Project Settings > API > service_role (secret)');
  console.log('\nRun command:');
  console.log('  $env:SUPABASE_SERVICE_ROLE_KEY="your-key-here"; node scripts/purge_auth_users.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('Connecting to Supabase Auth...');
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (error) {
    console.error('Failed to retrieve users:', error.message);
    process.exit(1);
  }

  const users = data.users;
  console.log(`Found ${users.length} user(s) in auth.users.`);

  if (users.length === 0) {
    console.log('No users to delete.');
    return;
  }

  for (const user of users) {
    process.stdout.write(`Deleting user: ${user.id} (${user.email || user.phone || 'no email'})... `);
    const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.log(`[FAILED: ${delErr.message}]`);
    } else {
      console.log('[OK]');
    }
  }

  console.log('\nDone! All test auth accounts have been deleted.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
