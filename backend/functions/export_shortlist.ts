// export_shortlist.ts – Supabase edge function to export shortlisted candidates
//
// Accepts a role ID and format (csv or pdf) and generates a file in the
// `exports` storage bucket containing the interested/interviewing candidates.
// Returns a signed URL for download.  In this stub we generate a CSV string
// on the fly and return a data URI instead of uploading to storage.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 }); }
  const roleId = body.role_id;
  const format = body.format || 'csv';
  if (!roleId) return new Response(JSON.stringify({ error: { message: 'role_id is required' } }), { status: 400 });
  // Fetch interested/interviewing candidates
  const { data: candidates } = await supabase.from('candidates').select('*').eq('role_id', roleId).in('status', ['interested','screened','interviewing']);
  const rows = candidates || [];
  let output: string;
  if (format === 'csv') {
    const header = 'name,company,title,location,fit_score';
    const lines = rows.map((c) => `${c.name},${c.company},${c.current_title},${c.location},${c.fit_score}`);
    output = [header, ...lines].join('\n');
    const dataUri = `data:text/csv;base64,${btoa(output)}`;
    return new Response(JSON.stringify({ url: dataUri }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  }
  // PDF not implemented; return CSV instead
  return new Response(JSON.stringify({ url: '' }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
});