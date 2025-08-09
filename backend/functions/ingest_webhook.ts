// ingest_webhook.ts – Supabase edge function to handle provider webhook events
//
// Providers like Apollo, SendGrid and Mailgun send webhook events when
// recipients open, reply, or bounce emails.  This endpoint verifies the
// signature (not implemented in this stub), records the event in the
// engagements table, and updates the candidate’s status accordingly.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

// In a production system you would verify the provider’s signature to ensure
// authenticity.  For this stub we simply accept the payload.

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let payload: any;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  // Extract candidate_id and event from payload.  Actual structure varies by provider.
  const candidateId = payload.candidate_id || payload.recipient_id;
  const event = payload.event || payload.type;
  if (!candidateId || !event) {
    return new Response(JSON.stringify({ error: { message: 'Missing candidate_id or event' } }), { status: 400 });
  }
  // Map events to candidate statuses
  let newStatus: string | null = null;
  if (event === 'opened') newStatus = 'contacted';
  if (event === 'replied') newStatus = 'interested';
  if (event === 'bounced') newStatus = 'rejected';
  // Insert engagement record
  await supabase.from('engagements').insert({ candidate_id: candidateId, event, payload });
  if (newStatus) {
    await supabase.from('candidates').update({ status: newStatus }).eq('id', candidateId);
  }
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});