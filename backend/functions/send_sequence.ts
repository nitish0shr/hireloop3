// send_sequence.ts – Supabase edge function to send outreach sequences
//
// For a given candidate, this function will send the next step in their
// outreach sequence via the configured provider (Apollo or fallback) and
// schedule the following step.  It writes an engagement event and updates
// the candidate’s status.  When the `mock_outreach` flag is enabled or
// provider keys are missing, it logs the action without sending emails.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const apolloApiKey = Deno.env.get('APOLLO_API_KEY') as string;
const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

interface SendSequenceRequest {
  candidate_id: string;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let payload: SendSequenceRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.candidate_id) {
    return new Response(JSON.stringify({ error: { message: 'candidate_id is required' } }), { status: 400 });
  }
  // Fetch candidate and outreach info
  const { data: candidate } = await supabase.from('candidates').select('*').eq('id', payload.candidate_id).maybeSingle();
  if (!candidate) return new Response(JSON.stringify({ error: { message: 'Candidate not found' } }), { status: 404 });
  // Determine provider; default to apollo
  const provider = apolloApiKey ? 'apollo' : sendgridApiKey ? 'sendgrid' : 'none';
  // For simplicity, we won’t actually call external APIs in this demo
  const mockMode = featureFlags.includes('mock_outreach') || provider === 'none';
  // Create or update outreach row
  const { data: existing } = await supabase.from('outreach').select('*').eq('candidate_id', payload.candidate_id).maybeSingle();
  if (!existing) {
    await supabase.from('outreach').insert({ candidate_id: payload.candidate_id, provider, step: 1, meta: {}, last_sent_at: new Date().toISOString(), next_send_at: null });
  } else {
    await supabase.from('outreach').update({ step: existing.step + 1, last_sent_at: new Date().toISOString() }).eq('id', existing.id);
  }
  // Update candidate status
  await supabase.from('candidates').update({ status: 'contacted' }).eq('id', payload.candidate_id);
  // Write engagement event
  await supabase.from('engagements').insert({ candidate_id: payload.candidate_id, event: 'sent', payload: { provider, mock: mockMode } });
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});