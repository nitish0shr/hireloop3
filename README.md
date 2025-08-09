# HireLoop – Autonomous AI Recruiting SaaS

**HireLoop** is a proof‑of‑concept multi‑tenant recruiting platform designed to automate the sourcing and screening of technical talent.  It uses Supabase for authentication, data storage and edge functions, and a simple React front‑end served as a Progressive Web App (PWA) via Vercel.  The platform ingests job descriptions (JDs), scores candidate resumes against the role, automatically sources additional profiles from public search and Apollo.io when the pipeline is thin, and orchestrates outreach, follow‑ups and scheduling.  This repository provides everything you need to spin up a working demo and extend it into a production‑ready service.

> **Note:**  The code in this repository is designed to run with zero local setup.  The front‑end is a static single‑page app built with plain React and Tailwind via CDN.  The backend is defined as Supabase migrations and edge functions but also includes a simple Node server (`server.js`) that mocks the API endpoints for local demos.  To deploy to Supabase and Vercel you’ll need to supply valid API keys in `.env` and create a Supabase project.

## Contents

* `frontend/` – Static web application served from `/` that allows users to sign up, create organisations, define roles, upload resumes and view the pipeline.  It loads React, ReactDOM, TailwindCSS and Supabase JS directly from CDNs to avoid any build step.
* `backend/` – SQL migrations for the Postgres schema, row level security policies and seed data.  Edge functions written in TypeScript provide the API contract described in the specification (parse JD, screen resume, x‑ray search, Apollo enrichment, outreach, etc.).
* `server.js` – A simple Node HTTP server that serves the `frontend` directory and mocks the Supabase edge function endpoints.  Use this for local demos if you don’t have a Supabase instance.
* `docs/` – Prompt templates used by the LLM when parsing job descriptions, screening resumes and generating outreach copy.
* `.env.example` – Template containing environment variables for Supabase, OpenAI, Google CSE, Apollo.io and other integrations.  Copy to `.env` and fill in your own keys for deployment.

## Quick Start (Local Demo)

1.  **Install dependencies:**  There are no external dependencies for the front‑end.  For the mock backend server simply run Node (v18+) which is already installed in this environment.

    ```bash
    cd hireloop
    node server.js
    ```

    This will start a local HTTP server on port `3000`.  Open http://localhost:3000 in your browser.

2.  **Use the app:**  Sign up with a new email/password, create a new organisation, paste a job description and upload or paste resume text.  The app will show mock scoring and automatically trigger the sourcing pipeline when there are fewer than the configured minimum candidates.  Because the mock server is not connected to real external services, all responses are randomly generated but follow the shape of the real API.

3.  **Supabase deployment:**
    * Create a new [Supabase](https://supabase.com) project.  Copy your project URL and anon/service keys into `.env` based on `.env.example`.
    * Use the Supabase CLI or dashboard to apply the SQL migrations in `backend/schema.sql` to your database.  The file contains the table definitions and RLS policies.
    * Deploy the edge functions in `backend/functions/` using the Supabase CLI (`supabase functions deploy`).  Each function includes input validation with Zod and uses the official clients for OpenAI, Google CSE and Apollo.io.  Keys should be provided via environment variables.
    * Update the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values in your Vercel environment variables.  Deploy the `frontend` to Vercel (no build step required; it’s purely static).  Ensure that `public/_redirects` forces SPA routing if needed.

4.  **Vercel deployment:**
    * Create a new project in Vercel and link it to this repository.  Set the environment variables from `.env`.  Vercel will deploy the static `frontend` directory and serve it as a PWA.
    * Enable [Vercel Analytics](https://vercel.com/analytics) and [Sentry](https://sentry.io/) via Vercel’s integrations for monitoring.

5.  **Seed data:**  After deploying, run the SQL in `backend/seed.sql` (or use the provided `insert_demo_data` edge function) to create a demo organisation “HireLoop Demo Co” with a default recruiter and client, a sample role “Senior Backend Engineer” and six example candidates.  The demo includes a button in the app to simulate candidate replies to move the pipeline forward.

## Architecture Overview

### Front‑end

The UI is built as a collection of React components stored inline in `frontend/index.html`.  To keep the stack minimal there is no build system: all libraries are pulled directly from CDNs.  Routes are implemented through a very small client‑side router that listens to `hashchange` events.  TailwindCSS is loaded via its CDN in JIT mode, enabling the utility classes described in the specification.  The PWA manifest and service worker are provided in `frontend/public/`.

### Backend

The schema in `backend/schema.sql` defines tables for profiles, organisations, members, roles, candidates, outreach activities, engagements and configuration.  Row Level Security (RLS) policies ensure users can only read or write data belonging to their organisation.  Each edge function in `backend/functions/` is implemented in TypeScript with the Supabase Edge runtime and uses helper utilities for authentication and error handling.  The pipeline daemon runs on a schedule (via Supabase’s scheduled jobs or Upstash QStash) and orchestrates x‑ray searches, enrichment, outreach sequences and follow‑ups.

### Mock server

To aid local development without a Supabase instance, `server.js` implements a small HTTP server.  It uses Node’s built‑in `http` module to serve static files from the `frontend` directory and emulate the edge function endpoints (e.g. `/functions/v1/parse_jd`).  The server stores all data in memory and generates mock responses.  This allows you to click through the entire flow and capture screenshots even when working offline.

## RLS Policies

Row Level Security is critical for multi‑tenant SaaS.  The policies defined in `backend/schema.sql` ensure that users can only access records belonging to their organisation.  In summary:

* **Profiles:**  Users can only view and update their own profile.
* **Organisations and membership:**  You must be a member of an organisation to see it.  Only owners can invite new members or delete the organisation.
* **Roles and candidates:**  All reads and writes are restricted to members of the organisation that owns the role.  Clients have read‑only access.
* **Outreach and engagements:**  Only recruiters and owners can send outreach and view engagement data.  Clients cannot see email content or candidate PII.
* **Configuration:**  Config values are readable by members but writable only by owners and service roles.

## Running the Pipeline

The scheduled pipeline daemon monitors each open role’s pipeline depth and automatically kicks off sourcing and outreach when the number of candidates falls below `min_pipeline`.  It performs these steps in order:

1. **X‑ray search** – Builds operator queries from the role’s parsed keywords and calls the Google Custom Search API to discover publicly available profile URLs.
2. **Apollo enrichment** – Sends the scraped leads to Apollo.io to retrieve email addresses, company domains and other contact details.
3. **Resume screening** – When resumes are manually uploaded or returned from enrichment they are scored against the JD via OpenAI.  The agent computes culture, technical and experience scores and stores them in the database.
4. **Outreach sequencing** – Candidates with a score above a configurable threshold are enrolled in a compliant email sequence using Apollo.io or your fallback provider (SendGrid or Mailgun).  Follow‑ups are scheduled based on engagement events.  Replies trigger automatic screening and scheduling via Calendly.

The daemon includes exponential backoff and retries.  It is rate limited per organisation and logs all operations for observability.

## Screenshots

Screenshots and short GIFs of the core flows (JD parsing, resume screening, sourcing, outreach, reply processing and scheduling) can be found in `screenshots/`.  They were captured using the local mock server.  To generate your own, run the server and interact with the UI; you can then use the `mnt/host_files/screenshot.sh` script to capture frames.

## License

This project is provided as a demonstration under the MIT license.  It contains stubbed implementations and mock data to illustrate how to structure a full‑stack AI recruiting platform.  **Do not** use it in production without thoroughly reviewing and securing the code, especially around webhooks, external API integrations and data privacy.