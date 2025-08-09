// parse_jd.ts – Supabase edge function to parse a job description using OpenAI
//
// This function accepts a POST request with a JSON body containing either a raw
// job description or an existing roleId.  It validates the input, calls the
// OpenAI API to extract structured fields (or returns mock data when the
// `mock_parse_jd` feature flag is enabled) and optionally updates the
// corresponding row in the `roles` table.  The response is a JSON object
// containing the parsed fields and a list of search keywords.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

// Load environment variables
const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const openAiKey   = Deno.env.get('OPENAI_API_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ParseJDRequest {
  roleId?: string;
  jd_text: string;
}

interface ParsedJD {
  title: string;
  location: string;
  level: string;
  required_skills: string[];
  nice_to_have: string[];
  responsibilities: string[];
  keywords: string[];
  ideal_candidate_summary: string;
}

async function callOpenAI(jd: string): Promise<ParsedJD> {
  const prompt = `You are HireLoop Agent, an expert technical recruiter. Given a JD, output strict JSON with: title, location, level, required_skills[], nice_to_have[], responsibilities[], keywords[] (search operators), ideal_candidate_summary (2–3 sentences). Output ONLY JSON.\n\n${jd}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs strict JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    throw new Error(`OpenAI API error: ${resp.status}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  try {
    return JSON.parse(content) as ParsedJD;
  } catch (_e) {
    throw new Error('Failed to parse OpenAI response');
  }
}

function mockParse(jd: string): ParsedJD {
  // Very naive mock parser: extracts capitalised words as keywords
  const words = jd.match(/\b[A-Z][a-zA-Z0-9\.\+]+/g) || [];
  return {
    title: 'Unknown Title',
    location: '',
    level: 'Mid',
    required_skills: [],
    nice_to_have: [],
    responsibilities: [],
    keywords: words.slice(0, 5),
    ideal_candidate_summary: 'An ideal candidate should have relevant experience.',
  };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  }
  let payload: ParseJDRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.jd_text || typeof payload.jd_text !== 'string') {
    return new Response(JSON.stringify({ error: { message: 'jd_text is required' } }), { status: 400 });
  }
  let parsed: ParsedJD;
  try {
    if (featureFlags.includes('mock_parse_jd') || !openAiKey) {
      parsed = mockParse(payload.jd_text);
    } else {
      parsed = await callOpenAI(payload.jd_text);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: (err as Error).message } }), { status: 500 });
  }
  // If roleId provided, update roles.parsed_json
  if (payload.roleId) {
    await supabase.from('roles').update({ parsed_json: parsed }).eq('id', payload.roleId);
  }
  return new Response(JSON.stringify({ parsed, keywords: parsed.keywords }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});