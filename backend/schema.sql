-- HireLoop database schema
--
-- This file defines the Postgres tables and Row Level Security (RLS) policies for
-- HireLoop.  Apply this migration to your Supabase project to set up the
-- database.  All tables are created in the `public` schema.  Each table
-- enables RLS and defines policies restricting access to users within
-- their organisation.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Profiles table mirrors auth.users.  Additional fields (full_name, role)
-- are stored here.  The primary key matches auth.users.id.
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    text,
  role         text CHECK (role IN ('admin','recruiter','client')) DEFAULT 'recruiter',
  created_at   timestamptz DEFAULT now()
);

-- Organisations table stores tenant information.  Each org has a creator.
CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now()
);

-- Org membership table associates users with organisations.
CREATE TABLE IF NOT EXISTS public.org_members (
  org_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id   uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_role  text CHECK (org_role IN ('owner','member','viewer')) DEFAULT 'owner',
  PRIMARY KEY (org_id, user_id)
);

-- Roles/JDs owned by organisations
CREATE TABLE IF NOT EXISTS public.roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES public.profiles(id),
  title          text,
  location       text,
  description    text,             -- raw JD text
  parsed_json    jsonb,            -- structured JD
  mode           text DEFAULT 'standard',  -- 'standard' | 'interested_only'
  status         text DEFAULT 'open',       -- open|paused|closed
  min_pipeline   int DEFAULT 10,
  created_at     timestamptz DEFAULT now()
);

-- Candidates tied to a specific role
CREATE TABLE IF NOT EXISTS public.candidates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  name              text,
  current_title     text,
  company           text,
  location          text,
  linkedin          text,
  public_url        text,           -- GitHub/blog/portfolio/company page
  resume_url        text,           -- storage signed URL
  summary           text,
  culture_score     int,
  technical_score   int,
  experience_score  int,
  fit_score         int,            -- 0..100
  status            text DEFAULT 'sourced',  -- sourced|contacted|interested|screened|interviewing|offered|hired|rejected
  created_at        timestamptz DEFAULT now()
);

-- Outreach table records email sequences for candidates
CREATE TABLE IF NOT EXISTS public.outreach (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  provider     text,             -- 'apollo'|'sendgrid'|'mailgun'
  thread_id    text,
  step         int DEFAULT 1,
  template_id  text,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  meta         jsonb
);

-- Engagement events: opens, replies, scheduled meetings, etc.
CREATE TABLE IF NOT EXISTS public.engagements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  event        text,              -- sent|opened|replied|scheduled|bounced
  payload      jsonb,
  created_at   timestamptz DEFAULT now()
);

-- Config table stores editable JSON settings and prompts
CREATE TABLE IF NOT EXISTS public.config (
  key        text PRIMARY KEY,
  value      jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security on all tables
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config       ENABLE ROW LEVEL SECURITY;

-- RLS policies

-- Profiles: users can read/update only their own profile
CREATE POLICY "Profiles: members can view their profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Profiles: members can update their profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Organisations: members can select/update an organisation if they belong to it
CREATE POLICY "Orgs: members can view" ON public.organizations
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = public.organizations.id AND m.user_id = auth.uid()));

CREATE POLICY "Orgs: owners can manage" ON public.organizations
  FOR ALL USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = public.organizations.id AND m.user_id = auth.uid() AND m.org_role = 'owner'));

-- Org members: users can view membership for orgs they belong to
CREATE POLICY "Org members: view" ON public.org_members
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.org_members m2 WHERE m2.org_id = public.org_members.org_id AND m2.user_id = auth.uid()));

-- Org members: owners can add/remove members
CREATE POLICY "Org members: owners manage" ON public.org_members
  FOR ALL USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = public.org_members.org_id AND m.user_id = auth.uid() AND m.org_role = 'owner'));

-- Roles: members of an org can read; only recruiters/owners can insert/update
CREATE POLICY "Roles: members read" ON public.roles
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = public.roles.org_id AND m.user_id = auth.uid()));

CREATE POLICY "Roles: recruiters manage" ON public.roles
  FOR ALL USING (EXISTS (SELECT 1 FROM public.org_members m JOIN public.profiles p ON m.user_id = p.id WHERE m.org_id = public.roles.org_id AND m.user_id = auth.uid() AND p.role IN ('admin','recruiter')));

-- Candidates: access restricted by role ownership
CREATE POLICY "Candidates: members read" ON public.candidates
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roles r JOIN public.org_members m ON r.org_id = m.org_id WHERE r.id = public.candidates.role_id AND m.user_id = auth.uid()));

CREATE POLICY "Candidates: recruiters manage" ON public.candidates
  FOR ALL USING (EXISTS (SELECT 1 FROM public.roles r JOIN public.org_members m ON r.org_id = m.org_id JOIN public.profiles p ON m.user_id = p.id WHERE r.id = public.candidates.role_id AND m.user_id = auth.uid() AND p.role IN ('admin','recruiter')));

-- Outreach and engagements: only recruiters can see full details, but clients can see event counts
CREATE POLICY "Outreach: recruiters read" ON public.outreach
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.candidates c JOIN public.roles r ON c.role_id = r.id JOIN public.org_members m ON r.org_id = m.org_id JOIN public.profiles p ON m.user_id = p.id WHERE c.id = public.outreach.candidate_id AND m.user_id = auth.uid() AND p.role IN ('admin','recruiter')));

CREATE POLICY "Outreach: recruiters write" ON public.outreach
  FOR ALL USING (EXISTS (SELECT 1 FROM public.candidates c JOIN public.roles r ON c.role_id = r.id JOIN public.org_members m ON r.org_id = m.org_id JOIN public.profiles p ON m.user_id = p.id WHERE c.id = public.outreach.candidate_id AND m.user_id = auth.uid() AND p.role IN ('admin','recruiter')));

CREATE POLICY "Engagements: members read" ON public.engagements
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.candidates c JOIN public.roles r ON c.role_id = r.id JOIN public.org_members m ON r.org_id = m.org_id WHERE c.id = public.engagements.candidate_id AND m.user_id = auth.uid()));

CREATE POLICY "Engagements: recruiters write" ON public.engagements
  FOR ALL USING (EXISTS (SELECT 1 FROM public.candidates c JOIN public.roles r ON c.role_id = r.id JOIN public.org_members m ON r.org_id = m.org_id JOIN public.profiles p ON m.user_id = p.id WHERE c.id = public.engagements.candidate_id AND m.user_id = auth.uid() AND p.role IN ('admin','recruiter')));

-- Config: owners and service roles can manage; members can read
CREATE POLICY "Config: members read" ON public.config
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));

CREATE POLICY "Config: owners write" ON public.config
  FOR ALL USING (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.org_members m JOIN public.profiles p ON m.user_id = p.id WHERE p.role = 'admin' AND m.user_id = auth.uid() LIMIT 1));