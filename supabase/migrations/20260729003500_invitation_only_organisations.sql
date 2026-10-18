-- Invitation only: a signed-in user without an invitation can no longer create their own organisation.
revoke execute on function public.create_organisation(text,text) from public,anon,authenticated;
