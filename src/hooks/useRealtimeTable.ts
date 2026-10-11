/**
 * useRealtimeTable.ts
 *
 * Subscribes to Supabase Realtime postgres_changes for a given table,
 * filtered by a user-owned column (e.g. patient_id = <id>).
 *
 * Whenever an INSERT, UPDATE or DELETE happens on that table, the
 * provided `onChanged` callback is invoked so the caller can refetch.
 *
 * Usage:
 *   useRealtimeTable('medicines', 'patient_id', patientId, fetchMedicines);
 *
 * Prerequisites (Supabase Dashboard):
 *   Database → Replication → Tables:
 *     ✅ medicines
 *     ✅ reminder_events
 *     ✅ medicine_logs
 */
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export function useRealtimeTable(
  table: string,
  filterColumn: string,
  filterValue: string | null | undefined,
  onChanged: () => void,
  events: RealtimeEvent[] = ['INSERT', 'UPDATE', 'DELETE'],
) {
  useEffect(() => {
    // Don't subscribe until we have a patient ID
    if (!filterValue) return;

    const channelName = `realtime-${table}-${filterValue}`;

    // Build the channel with one subscription per event type
    let channel = supabase.channel(channelName);

    for (const event of events) {
      channel = channel.on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter: `${filterColumn}=eq.${filterValue}`,
        },
        () => {
          onChanged();
        }
      );
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Realtime] subscribed to ${table} for ${filterColumn}=${filterValue}`);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filterColumn, filterValue]);
}
