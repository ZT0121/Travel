begin;
create table public.hub_households (id uuid primary key default gen_random_uuid());
create table public.hub_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.hub_households(id) on delete cascade
);
alter table public.hub_households enable row level security;
alter table public.hub_members enable row level security;
revoke all on public.hub_households,public.hub_members from public,anon,authenticated;
grant select on public.hub_members to authenticated;
create policy own_membership on public.hub_members for select to authenticated using (user_id=(select auth.uid()));
create function public.hub_household_id() returns uuid language sql stable security invoker set search_path='' as $$
  select household_id from public.hub_members where user_id=(select auth.uid())
$$;
revoke all on function public.hub_household_id() from public,anon;
grant execute on function public.hub_household_id() to authenticated;

-- Preserve households that already have saved data under the original schema.
insert into public.hub_households(id) select distinct owner_id from public.trips union select owner_id from public.hub_removed_images;
insert into public.hub_members select id,id from public.hub_households;

do $$
declare t text;
begin
 foreach t in array array['trips','itinerary_items','saved_places','shopping_items','expenses','packing_items','hub_removed_images'] loop
   execute format('alter table public.%I drop constraint %I, add foreign key(owner_id) references public.hub_households(id) on delete cascade',t,t||'_owner_id_fkey');
   if t <> 'hub_removed_images' then
     execute format('alter table public.%I alter owner_id set default public.hub_household_id()',t);
     execute format('alter policy household on public.%I using(owner_id=(select public.hub_household_id())) with check(owner_id=(select public.hub_household_id()))',t);
   end if;
 end loop;
end $$;
alter policy image_jobs on public.hub_removed_images
 using(owner_id=(select public.hub_household_id()))
 with check(owner_id=(select public.hub_household_id()) and split_part(path,'/',1)=owner_id::text);
alter policy hub_image_read on storage.objects using(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select public.hub_household_id())::text);
alter policy hub_image_write on storage.objects with check(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select public.hub_household_id())::text);
alter policy hub_image_remove on storage.objects using(bucket_id='travel-shopping' and (storage.foldername(name))[1]=(select public.hub_household_id())::text);
commit;
