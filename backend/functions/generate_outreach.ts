// generate_outreach.ts – Supabase edge function to craft personalised outreach
//
// Given a role ID and candidate ID, this function uses OpenAI to generate a
// subject line and email body tailored to the candidate and job.  It stores
// the template in the outreach table meta for later use.  When the
// `mock_outreach` feature flag is enabled or OPENAI_API_KEY is missing, it
// returns a simple canned email.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const openAiKey   = Deno.env.get('OPENAI_API_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

interface OutreachRequest {
  role_id: string;
  candidate_id: string;
  tone?: string;
}

interface OutreachResponse {
  subject: string;
  body: string;
}

async function callOpenAI(role: any, candidate: any, tone: string): Promise<OutreachResponse> {
  const jd = role.parsed_json || {};
  const candName = candidate.name || 'Candidate';
  const prompt = `You write concise, human outreach for passive candidates. Using the JD and candidate profile, craft subject + 120–160 word email with a single clear CTA link (Calendly). Tone: ${tone || 'professional'}, specific, respectful. Output ONLY JSON with subject, body.\n\nJD: ${JSON.stringify(jd)}\n\nCandidate: ${JSON.stringify(candidate)}`;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [ { role: 'system', content: 'You are HireLoop outreach agent.' }, { role: 'user', content: prompt } ],
      max_tokens: 300,
      temperature: 0.5,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI error ${resp.status}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  try {
    return JSON.parse(content) as OutreachResponse;
  } catch (_e) {
    throw new Error('Invalid OpenAI response');
  }
}

function mockOutreach(candidateName: string): OutreachResponse {
  return {
    subject: `Opportunity to chat about a new role`,
    body: `Hello ${candidateName},\n\nI hope you’re doing well! I’m reaching out about a senior engineering position that I think aligns with your background. If you’re open to a quick chat, please grab a slot on my calendar here: {{calendly_link}}.\n\nBest regards,\nHireLoop Recruiter`,
  };
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let payload: OutreachRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.role_id || !payload.candidate_id) {
    return new Response(JSON.stringify({ error: { message: 'role_id and candidate_id are required' } }), { status: 400 });
  }
  // Fetch role and candidate from DB
  const { data: role } = await supabase.from('roles').select('*').eq('id', payload.role_id).maybeSingle();
  const { data: candidate } = await supabase.from('candidates').select('*').eq('id', payload.candidate_id).maybeSingle();
  if (!role || !candidate) {
    return new Response(JSON.stringify({ error: { message: 'Role or candidate not found' } }), { status: 404 });
  }
  let result: OutreachResponse;
  try {
    if (featureFlags.includes('mock_outreach') || !openAiKey) {
      result = mockOutreach(candidate.name || 'Candidate');
    } else {
      result = await callOpenAI(role, candidate, payload.tone || 'professional');
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: (err as Error).message } }), { status: 500 });
  }
  // Insert into outreach table
  await supabase.from('outreach').insert({
    candidate_id: payload.candidate_id,
    provider: 'apollo',
    thread_id: null,
    step: 1,
    template_id: null,
    last_sent_at: null,
    next_send_at: null,
    meta: result,
  });
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});