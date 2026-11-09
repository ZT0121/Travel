-- Run once in a dedicated Supabase project.
begin;
create function public.hub_revision() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id then raise exception 'immutable identity'; end if;
  if tg_table_name <> 'trips' then
    if new.trip_id <> old.trip_id then raise exception 'immutable trip'; end if;
  end if;
  new.version := old.version + 1;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
do $$
declare t text; relation text;
begin
 foreach t in array array['trips','itinerary_items','saved_places','shopping_items','expenses','packing_items'] loop
   relation := case when t = 'trips' then ', unique(id,owner_id)' else
     ', trip_id uuid not null, foreign key(trip_id,owner_id) references public.trips(id,owner_id) on delete cascade' end;
   execute format('create table public.%I (
     id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
     data jsonb not null check(jsonb_typeof(data) = ''object''), version bigint not null default 1,
     mutation uuid not null, deleted boolean not null default false,
     created_at timestamptz not null default now(), updated_at timestamptz not null default now() %s)',t,relation);
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public, anon, authenticated',t);
   execute format('grant select, insert, update on public.%I to authenticated',t);
   execute format('create policy household on public.%I for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',t);
   execute format('create index on public.%I(owner_id,id)',t);
   execute format('create trigger revision before update on public.%I for each row execute function public.hub_revision()',t);
   execute format('alter publication supabase_realtime add table public.%I',t);
 end loop;
end $$;
-- Tombstones let a returning offline device observe deletions.
create function public.hub_trip_children() returns trigger language plpgsql
set search_path = '' as $$
declare t text;
begin
  if new.deleted and not old.deleted then
    foreach t in array array['itinerary_items','saved_places','shopping_items','expenses','packing_items'] loop
      execute format('update public.%I set deleted=true, mutation=gen_random_uuid() where trip_id=$1 and not deleted',t) using new.id;
    end loop;
  end if;
  return new;
end $$;
create trigger hub_trip_deleted after update on public.trips for each row execute function public.hub_trip_children();

create function public.hub_active_trip() returns trigger language plpgsql
set search_path = '' as $$
begin
  if not new.deleted then
    perform 1 from public.trips where id=new.trip_id and owner_id=new.owner_id and not deleted for share;
    if not found then raise exception 'Trip unavailable'; end if;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
 foreach t in array array['itinerary_items','saved_places','shopping_items','expenses','packing_items'] loop
   execute format('create trigger active_trip before insert or update on public.%I for each row execute function public.hub_active_trip()',t);
 end loop;
end $$;

-- Store cleanup jobs in the same transaction as the image reference change.
create table public.hub_removed_images (
 path text primary key, owner_id uuid not null references auth.users(id) on delete cascade
);
alter table public.hub_removed_images enable row level security;
revoke all on public.hub_removed_images from public,anon,authenticated;
grant select,insert,delete on public.hub_removed_images to authenticated;
create policy image_jobs on public.hub_removed_images for all to authenticated
 using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()) and split_part(path,'/',1)=owner_id::text);
create function public.hub_removed_photo() returns trigger language plpgsql
set search_path = '' as $$
begin
 if old.data->>'image' is not null and (new.deleted or (old.data->>'image') is distinct from (new.data->>'image')) then
   insert into public.hub_removed_images(path,owner_id) values(old.data->>'image',old.owner_id) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger image_cleanup after update on public.shopping_items for each row execute function public.hub_removed_photo();
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 values ('travel-shopping','travel-shopping',false,2097152,array['image/jpeg']);
create policy hub_image_read on storage.objects for select to authenticated
 using(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy hub_image_write on storage.objects for insert to authenticated
 with check(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy hub_image_remove on storage.objects for delete to authenticated
 using(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
