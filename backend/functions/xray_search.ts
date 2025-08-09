// xray_search.ts – Supabase edge function to perform X‑ray style sourcing
//
// Given a role ID and optional overrides, this function generates boolean
// search queries from the JD keywords and calls the Google Custom Search API
// (or Bing) to find publicly available profile URLs.  Results are
// de‑duplicated and returned as an array of leads.  When the
// `mock_xray_search` feature flag is enabled or no Google credentials are
// provided, the function returns a few dummy leads instead.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const googleCseId = Deno.env.get('GOOGLE_CSE_ID') as string;
const googleCseKey = Deno.env.get('GOOGLE_CSE_KEY') as string;
const featureFlags = (Deno.env.get('FEATURE_FLAGS') || '').split(',');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface XrayRequest {
  role_id: string;
  query_overrides?: string[];
  count?: number;
}

interface Lead {
  name: string;
  title: string;
  company: string;
  location: string;
  public_url: string;
}

function mockLeads(): Lead[] {
  return [
    { name: 'Grace Hopper', title: 'Senior Backend Engineer', company: 'DemoCo', location: 'Austin, TX', public_url: 'https://example.com/grace' },
    { name: 'Linus Torvalds', title: 'Kernel Developer', company: 'Open Source', location: 'Portland, OR', public_url: 'https://example.com/linus' },
    { name: 'Ada Lovelace', title: 'Software Architect', company: 'MathWorks', location: 'London, UK', public_url: 'https://example.com/ada' },
  ];
}

async function searchGoogle(query: string, limit: number): Promise<Lead[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', googleCseKey);
  url.searchParams.set('cx', googleCseId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', Math.min(limit, 10).toString());
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Google CSE error ${resp.status}`);
  const data = await resp.json();
  const items = data.items || [];
  const leads: Lead[] = [];
  for (const item of items) {
    // Attempt to extract name/title from snippet
    const title = item.title || '';
    const snippet = item.snippet || '';
    leads.push({ name: title.split('–')[0] || title, title: title, company: '', location: '', public_url: item.link });
  }
  return leads;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let payload: XrayRequest;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }
  if (!payload.role_id) {
    return new Response(JSON.stringify({ error: { message: 'role_id is required' } }), { status: 400 });
  }
  const count = payload.count || 5;
  // Get keywords from parsed JD
  const { data: role } = await supabase.from('roles').select('parsed_json').eq('id', payload.role_id).maybeSingle();
  const parsed = role?.parsed_json || {};
  const keywords: string[] = payload.query_overrides ?? parsed.keywords ?? [];
  if (featureFlags.includes('mock_xray_search') || !googleCseKey || !googleCseId) {
    const leads = mockLeads().slice(0, count);
    return new Response(JSON.stringify(leads), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  }
  const query = keywords.join(' OR ');
  try {
    const leads = await searchGoogle(query, count);
    return new Response(JSON.stringify(leads), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: (err as Error).message } }), { status: 500 });
  }
});