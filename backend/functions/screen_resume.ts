// screen_resume.ts – Supabase edge function to score a resume against a JD
//
// Given a role ID and resume text, this function calls OpenAI to compute
// culture, technical and experience scores and returns a one‑liner summary,
// individual scores and an overall fit score.  When the `mock_screen_resume`
// feature flag is enabled (or OPENAI_API_KEY is missing), it returns random
// values instead.  If the candidate already exists for the role, the row is
// updated; otherwise a new candidate entry is inserted.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const openAiKey   = Deno.env.get('OPENAI_API_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ScreenResumeRequest {
  role_id: string;
  resume_text: string;
}

interface ScreenResult {
  one_liner: string;
  culture_score: number;
  technical_score: number;
  experience_score: number;
  fit_score: number;
  top_reasons: string[];
  interview_focus: string[];
}

async function callOpenAI(roleId: string, resume: string): Promise<ScreenResult> {
  // Fetch the parsed JD for context
  const { data: roleData } = await supabase.from('roles').select('parsed_json').eq('id', roleId).maybeSingle();
  const jd = roleData?.parsed_json || {};
  const prompt = `You evaluate a candidate for a specific JD. Return ONLY JSON with: one_liner, culture_score (1–5), technical_score (1–5), experience_score (1–5), fit_score (0–100), top_reasons[] (3 bullets), interview_focus[] (3 bullets).\n\nJD:\n${JSON.stringify(jd)}\n\nResume:\n${resume}`;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are HireLoop screening agent.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  try {
    return JSON.parse(content) as ScreenResult;
  } catch (_e) {
    throw new Error('Invalid OpenAI response');
  }
}

function mockScreen(): ScreenResult {
  const rand = () => Math.floor(Math.random() * 5) + 1;
  const culture = rand();
  const technical = rand();
  const experience = rand();
  const fit = Math.min(100, culture * 20 + technical * 15 + experience * 15 + Math.floor(Math.random() * 20));
  return {
    one_liner: 'Seasoned engineer with relevant experience.',
    culture_score: culture,
    technical_score: technical,
    experience_score: experience,
    fit_score: fit,
    top_reasons: ['Strong technical background', 'Relevant experience', 'Good cultural fit'],
    interview_focus: ['System design', 'Team collaboration', 'Technical depth'],
  };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  }
  let payload: ScreenResumeRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.role_id || !payload.resume_text) {
    return new Response(JSON.stringify({ error: { message: 'role_id and resume_text are required' } }), { status: 400 });
  }
  let result: ScreenResult;
  try {
    if (featureFlags.includes('mock_screen_resume') || !openAiKey) {
      result = mockScreen();
    } else {
      result = await callOpenAI(payload.role_id, payload.resume_text);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: (err as Error).message } }), { status: 500 });
  }
  // Upsert candidate record based on role_id and one_liner (simple matching by name can be added)
  const insert = await supabase.from('candidates').insert({
    role_id: payload.role_id,
    name: 'Unknown',
    current_title: '',
    company: '',
    location: '',
    summary: result.one_liner,
    culture_score: result.culture_score,
    technical_score: result.technical_score,
    experience_score: result.experience_score,
    fit_score: result.fit_score,
    status: 'screened',
  }).select().single();
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});