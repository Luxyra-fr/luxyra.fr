-- 16/10/2026 — Photos produits en bonne qualité (appliqué). Bucket public « produits-photos », dossier = id établissement.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('produits-photos','produits-photos',true,3145728,array['image/jpeg','image/webp','image/png'])
on conflict (id) do update set public=true, file_size_limit=3145728, allowed_mime_types=array['image/jpeg','image/webp','image/png'];
-- insert / update / delete / select : uniquement dans le dossier de SON établissement (salons.user_id = auth.uid())
-- (policies produits_photos_insert, _update, _delete, _select sur storage.objects)
-- Bot : support_bot_kb cle 'photos_produits_1016'.
