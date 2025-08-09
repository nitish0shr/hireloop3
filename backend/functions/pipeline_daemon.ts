// pipeline_daemon.ts – scheduled Supabase edge function to maintain the pipeline
//
// This function is intended to run on a schedule (e.g. every 15 minutes).  It
// iterates through each open role and ensures the pipeline has at least
// `min_pipeline` candidates.  It triggers x‑ray search, enrichment and
// outreach steps as needed and advances existing sequences.  In this stub
// implementation we simply count the candidates per role and insert a log
// entry into the config table when the pipeline is thin.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

serve(async (_req) => {
  // Fetch all open roles
  const { data: roles } = await supabase.from('roles').select('*').eq('status', 'open');
  for (const role of roles || []) {
    // Count candidates for role
    const { count, error } = await supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('role_id', role.id);
    if (error) continue;
    if ((count || 0) < (role.min_pipeline || 0)) {
      // Write a log entry to config table to indicate pipeline is thin
      const logKey = `pipeline_${role.id}_${Date.now()}`;
      await supabase.from('config').insert({ key: logKey, value: { message: `Pipeline underfilled for role ${role.title}`, count } });
    }
  }
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});