/*
 * Simple HTTP server to serve the HireLoop demo locally.
 *
 * This server provides two main functions:
 *  1. Serves static files from the `frontend` directory (HTML, CSS, JS).
 *  2. Implements mock endpoints under `/functions/v1/*` that emulate the
 *     behaviour of the Supabase edge functions.  All data is stored in
 *     memory and resets when the server restarts.  The goal is to allow
 *     developers to interact with the UI end‑to‑end without requiring a
 *     Supabase backend or external API keys.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// In‑memory store for demo purposes
const store = {
  orgs: [],
  roles: [],
  candidates: [],
  outreach: [],
  engagements: [],
  users: [],
};

// Utility to send JSON responses
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Generate a pseudo‑UUID
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Serve static files
function serveStatic(req, res) {
  let filePath = path.join(__dirname, 'frontend', req.url === '/' ? 'index.html' : req.url);
  // Prevent directory traversal
  if (!filePath.startsWith(path.join(__dirname, 'frontend'))) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routing
      filePath = path.join(__dirname, 'frontend', 'index.html');
    }
    fs.readFile(filePath, (err2, content) => {
      if (err2) {
        json(res, 500, { error: 'File read error' });
        return;
      }
      const ext = path.extname(filePath);
      const mimeMap = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'text/plain' });
      res.end(content);
    });
  });
}

// Mock parse_jd endpoint
function handleParseJD(body, res) {
  const jdText = body.jd_text;
  const words = jdText.match(/\b[A-Z][a-zA-Z0-9\.\+]+/g) || [];
  const parsed = {
    title: 'Unknown',
    location: '',
    level: 'Mid',
    required_skills: [],
    nice_to_have: [],
    responsibilities: [],
    keywords: words.slice(0, 5),
    ideal_candidate_summary: 'An ideal candidate should have relevant experience.',
  };
  json(res, 200, { parsed, keywords: parsed.keywords });
}

// Mock screen_resume endpoint
function handleScreenResume(body, res) {
  const rand = () => Math.floor(Math.random() * 5) + 1;
  const result = {
    one_liner: 'Seasoned engineer with relevant experience.',
    culture_score: rand(),
    technical_score: rand(),
    experience_score: rand(),
    fit_score: Math.floor(Math.random() * 100),
    top_reasons: ['Strong technical background', 'Relevant experience', 'Good cultural fit'],
    interview_focus: ['System design', 'Team collaboration', 'Technical depth'],
  };
  // Insert candidate into memory
  store.candidates.push({
    id: uuid(),
    role_id: body.role_id || '',
    name: 'Unknown',
    summary: result.one_liner,
    culture_score: result.culture_score,
    technical_score: result.technical_score,
    experience_score: result.experience_score,
    fit_score: result.fit_score,
    status: 'screened',
  });
  json(res, 200, result);
}

// Mock xray_search endpoint
function handleXraySearch(body, res) {
  const leads = [
    { name: 'Grace Hopper', title: 'Senior Backend Engineer', company: 'DemoCo', location: 'Austin, TX', public_url: 'https://example.com/grace' },
    { name: 'Linus Torvalds', title: 'Kernel Developer', company: 'Open Source', location: 'Portland, OR', public_url: 'https://example.com/linus' },
    { name: 'Ada Lovelace', title: 'Software Architect', company: 'MathWorks', location: 'London, UK', public_url: 'https://example.com/ada' },
  ];
  json(res, 200, leads.slice(0, body.count || 3));
}

// Mock apollo_enrich endpoint
function handleEnrich(body, res) {
  const enriched = body.leads.map((l) => ({
    ...l,
    email: `${l.name.split(' ')[0].toLowerCase()}@example.com`,
    linkedin: l.public_url || `https://linkedin.com/in/${l.name.split(' ').join('').toLowerCase()}`,
    company_domain: (l.company || 'example') + '.com',
  }));
  // Insert into candidates with sourced status
  enriched.forEach((lead) => {
    store.candidates.push({
      id: uuid(),
      role_id: body.role_id,
      name: lead.name,
      current_title: lead.title,
      company: lead.company,
      location: lead.location,
      public_url: lead.public_url,
      linkedin: lead.linkedin,
      status: 'sourced',
    });
  });
  json(res, 200, enriched);
}

// Mock generate_outreach endpoint
function handleGenerateOutreach(body, res) {
  const candidate = store.candidates.find((c) => c.id === body.candidate_id) || {};
  const subject = `Opportunity to chat about ${body.role_id || 'a new role'}`;
  const bodyText = `Hello ${candidate.name || 'candidate'},\n\nWe found your profile and think you might be a great fit. If you’re interested, please schedule a call using this link: {{calendly}}.\n\nRegards,\nHireLoop`;
  // Save outreach meta
  store.outreach.push({ id: uuid(), candidate_id: body.candidate_id, provider: 'mock', step: 1, meta: { subject, body: bodyText } });
  json(res, 200, { subject, body: bodyText });
}

// Mock send_sequence endpoint
function handleSendSequence(body, res) {
  const cand = store.candidates.find((c) => c.id === body.candidate_id);
  if (cand) cand.status = 'contacted';
  store.engagements.push({ id: uuid(), candidate_id: body.candidate_id, event: 'sent', payload: {} });
  json(res, 200, { success: true });
}

// Mock ingest_webhook endpoint
function handleIngestWebhook(body, res) {
  const cand = store.candidates.find((c) => c.id === body.candidate_id);
  if (cand) {
    if (body.event === 'replied') cand.status = 'interested';
    if (body.event === 'opened') cand.status = 'contacted';
    if (body.event === 'bounced') cand.status = 'rejected';
  }
  store.engagements.push({ id: uuid(), candidate_id: body.candidate_id, event: body.event, payload: body });
  json(res, 200, { success: true });
}

// Mock schedule_meeting endpoint
function handleScheduleMeeting(body, res) {
  const cand = store.candidates.find((c) => c.id === body.candidate_id);
  if (cand) cand.status = 'interviewing';
  const meetingUrl = `https://calendly.com/demo/${body.candidate_id}`;
  store.engagements.push({ id: uuid(), candidate_id: body.candidate_id, event: 'scheduled', payload: { meetingUrl } });
  json(res, 200, { meetingUrl });
}

// Mock export_shortlist endpoint
function handleExportShortlist(body, res) {
  const roleId = body.role_id;
  const candidates = store.candidates.filter((c) => c.role_id === roleId && ['interested','interviewing','screened'].includes(c.status));
  const header = 'name,company,title,location,fit_score';
  const lines = candidates.map((c) => `${c.name},${c.company},${c.current_title},${c.location},${c.fit_score || ''}`);
  const csv = [header, ...lines].join('\n');
  const url = `data:text/csv;base64,${Buffer.from(csv).toString('base64')}`;
  json(res, 200, { url });
}

// Route requests under /functions/v1
function routeApi(req, res, body) {
  const url = req.url;
  if (url === '/functions/v1/parse_jd') return handleParseJD(body, res);
  if (url === '/functions/v1/screen_resume') return handleScreenResume(body, res);
  if (url === '/functions/v1/xray_search') return handleXraySearch(body, res);
  if (url === '/functions/v1/apollo_enrich') return handleEnrich(body, res);
  if (url === '/functions/v1/generate_outreach') return handleGenerateOutreach(body, res);
  if (url === '/functions/v1/send_sequence') return handleSendSequence(body, res);
  if (url === '/functions/v1/ingest_webhook') return handleIngestWebhook(body, res);
  if (url === '/functions/v1/schedule_meeting') return handleScheduleMeeting(body, res);
  if (url === '/functions/v1/export_shortlist') return handleExportShortlist(body, res);
  // Unknown endpoint
  json(res, 404, { error: 'Not found' });
}

// Main request handler
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/functions/v1')) {
    // Parse JSON body
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(data || '{}'); } catch {}
      routeApi(req, res, body);
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`HireLoop demo server running at http://localhost:${PORT}`);
});