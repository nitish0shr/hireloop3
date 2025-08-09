-- Seed data for HireLoop demo
--
-- This script inserts a demo organisation with one recruiter and one client,
-- a sample role and six example candidates.  Before running, replace the
-- placeholders `<recruiter-id>` and `<client-id>` with the actual `auth.users.id`
-- values of the users you want to make the owner and viewer of the demo
-- organisation.  You can find user IDs by querying `auth.users` in your
-- Supabase project.

-- Variables
-- Replace these with actual UUIDs
-- \set recruiter_id '00000000-0000-0000-0000-000000000000'
-- \set client_id    '11111111-1111-1111-1111-111111111111'

-- Create the organisation
INSERT INTO public.organizations (id, name, created_by)
VALUES (gen_random_uuid(), 'HireLoop Demo Co', :recruiter_id)
RETURNING id INTO org_id;

-- Memberships
INSERT INTO public.org_members (org_id, user_id, org_role) VALUES
  (org_id, :recruiter_id, 'owner'),
  (org_id, :client_id,    'viewer');

-- Create a sample role
INSERT INTO public.roles (id, org_id, created_by, title, location, description, parsed_json, mode, status, min_pipeline)
VALUES (
  gen_random_uuid(),
  org_id,
  :recruiter_id,
  'Senior Backend Engineer',
  'Austin, TX',
  'We are looking for a Senior Backend Engineer to build scalable APIs using Node.js and PostgreSQL.',
  '{"title":"Senior Backend Engineer","location":"Austin, TX","level":"Senior","required_skills":["Node.js","PostgreSQL"],"nice_to_have":["GraphQL","AWS"],"responsibilities":["Design and implement backend services","Collaborate with product and frontend teams"],"keywords":["site:github.com Node.js Austin","site:linkedin.com backend engineer"],"ideal_candidate_summary":"An experienced backend engineer comfortable with Node.js and relational databases."}',
  'standard',
  'open',
  3
)
RETURNING id INTO role_id;

-- Insert mock candidates
INSERT INTO public.candidates (id, role_id, name, current_title, company, location, linkedin, public_url, resume_url, summary, culture_score, technical_score, experience_score, fit_score, status)
VALUES
  (gen_random_uuid(), role_id, 'Alice Johnson',  'Software Engineer', 'TechCorp',  'Austin, TX', 'https://linkedin.com/in/alice',  'https://github.com/alice',  null, 'Seasoned backend developer with Node.js and PostgreSQL experience.', 4, 4, 5, 80, 'sourced'),
  (gen_random_uuid(), role_id, 'Bob Smith',     'Backend Developer',  'InnovateX', 'Dallas, TX', 'https://linkedin.com/in/bob',    'https://bob.dev',       null, 'Backend engineer specialising in microservices and REST APIs.',  3, 5, 4, 75, 'contacted'),
  (gen_random_uuid(), role_id, 'Charlie Davis', 'Full‑stack Dev',    'Startify',  'Houston, TX','https://linkedin.com/in/charlie','https://charlie.io',   null, 'Full‑stack developer with emphasis on backend Node.js.',           4, 3, 3, 70, 'interested'),
  (gen_random_uuid(), role_id, 'Dana Lee',      'Senior Engineer',   'DataWorks', 'San Antonio','https://linkedin.com/in/dana',   null,                 null, 'Senior engineer experienced with cloud services and Node.js.',    5, 4, 5, 85, 'screened'),
  (gen_random_uuid(), role_id, 'Evan Gomez',    'Lead Developer',    'DevShop',   'Austin, TX','https://linkedin.com/in/evan',   'https://evan.dev',    null, 'Tech lead with expertise in designing scalable services.',        3, 5, 5, 78, 'interviewing'),
  (gen_random_uuid(), role_id, 'Fiona Chen',    'Backend Engineer',  'AppWorks',  'Round Rock','https://linkedin.com/in/fiona',  null,                 null, 'Backend engineer with a passion for building robust APIs.',        4, 4, 4, 77, 'sourced');