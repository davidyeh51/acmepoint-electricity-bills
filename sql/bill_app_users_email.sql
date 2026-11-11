-- Support real company/external email accounts in bill_app_users alongside legacy usernames
ALTER TABLE public.bill_app_users
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.bill_app_users
  DROP CONSTRAINT IF EXISTS bill_app_users_username_check;

ALTER TABLE public.bill_app_users
  ADD CONSTRAINT bill_app_users_username_check
  CHECK (char_length(btrim(username)) >= 3 AND char_length(btrim(username)) <= 254);

UPDATE public.bill_app_users b
SET email = lower(u.email)
FROM auth.users u
WHERE b.user_id = u.id
  AND (b.email IS NULL OR b.email <> lower(u.email));

CREATE UNIQUE INDEX IF NOT EXISTS bill_app_users_email_key
  ON public.bill_app_users (lower(email))
  WHERE email IS NOT NULL;

-- Link existing company owner email (davidyeh@acmepointes.com) to bill_app_users as admin if present in auth.users
INSERT INTO public.bill_app_users (user_id, username, email, role, active)
SELECT u.id, lower(u.email), lower(u.email), 'admin', true
FROM auth.users u
WHERE lower(u.email) = 'davidyeh@acmepointes.com'
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email;
