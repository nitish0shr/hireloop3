// apollo_enrich.ts – Supabase edge function to enrich scraped leads via Apollo.io
//
// Accepts an array of leads (name, company, location, public_url) and calls
// Apollo.io’s API to retrieve work email, LinkedIn URL and company domain.
// Inserts each enriched lead into the candidates table.  When the
// `mock_enrich` feature flag is enabled or no Apollo API key is provided,
// returns mocked enrichment data instead.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const apolloApiKey = Deno.env.get('APOLLO_API_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

interface Lead {
  name: string;
  company?: string;
  location?: string;
  public_url?: string;
}

interface EnrichedLead extends Lead {
  email?: string;
  linkedin?: string;
  company_domain?: string;
}

interface EnrichRequest {
  role_id: string;
  leads: Lead[];
}

function mockEnrich(leads: Lead[]): EnrichedLead[] {
  return leads.map((l, idx) => ({
    ...l,
    email: `${l.name.split(' ')[0].toLowerCase()}@example.com`,
    linkedin: l.public_url || `https://linkedin.com/in/${l.name.split(' ').join('').toLowerCase()}`,
    company_domain: (l.company || 'example') + '.com',
  }));
}

async function callApollo(leads: Lead[]): Promise<EnrichedLead[]> {
  // Apollo bulk enrichment API (pseudo): POST /v1/people/match
  const resp = await fetch('https://api.apollo.io/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': apolloApiKey },
    body: JSON.stringify({ leads }),
  });
  if (!resp.ok) throw new Error(`Apollo API error ${resp.status}`);
  const data = await resp.json();
  return data.leads as EnrichedLead[];
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let payload: EnrichRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.role_id || !Array.isArray(payload.leads)) {
    return new Response(JSON.stringify({ error: { message: 'role_id and leads are required' } }), { status: 400 });
  }
  let enriched: EnrichedLead[];
  try {
    if (featureFlags.includes('mock_enrich') || !apolloApiKey) {
      enriched = mockEnrich(payload.leads);
    } else {
      enriched = await callApollo(payload.leads);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: (err as Error).message } }), { status: 500 });
  }
  // Insert enriched leads into candidates
  const inserts = enriched.map((lead) => ({
    role_id: payload.role_id,
    name: lead.name,
    company: lead.company || '',
    location: lead.location || '',
    public_url: lead.public_url || '',
    linkedin: lead.linkedin || '',
    // resume_url, summary and scores will be filled after screening
    status: 'sourced',
  }));
  await supabase.from('candidates').insert(inserts);
  return new Response(JSON.stringify(enriched), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});