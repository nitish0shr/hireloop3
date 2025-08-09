// schedule_meeting.ts – Supabase edge function to book interviews via Calendly
//
// This function accepts a candidate ID and optionally a specific slot.  It
// calls the Calendly API using the organisation token to create a meeting
// invite and records the event in the engagements table.  In this stub
// implementation we simply update the candidate’s status to "screened" or
// "interviewing" and return a mock Calendly URL.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const calendlyToken = Deno.env.get('CALENDLY_TOKEN') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  const candidateId = body.candidate_id;
  if (!candidateId) return new Response(JSON.stringify({ error: { message: 'candidate_id is required' } }), { status: 400 });
  // For demo, we generate a mock Calendly link
  const meetingUrl = `https://calendly.com/demo/${candidateId}`;
  // Update candidate status to interviewing
  await supabase.from('candidates').update({ status: 'interviewing' }).eq('id', candidateId);
  // Record engagement
  await supabase.from('engagements').insert({ candidate_id: candidateId, event: 'scheduled', payload: { meetingUrl } });
  return new Response(JSON.stringify({ meetingUrl }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});