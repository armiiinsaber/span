-- Attachments: a private bucket with one folder per person, named by their id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520, array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments: own folder" on storage.objects;
create policy "attachments: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
