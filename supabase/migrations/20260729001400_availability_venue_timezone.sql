begin;

create or replace function public.inspect_availability_request_v2(target_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods; staff public.staff_profiles; result jsonb;
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then return jsonb_build_object('state','invalid'); end if;
  if token_row.access_window_started_at is null or token_row.access_window_started_at<now()-interval '15 minutes' then update public.secure_response_tokens set access_count=1,access_window_started_at=now() where id=token_row.id;
  elsif token_row.access_count>=60 then return jsonb_build_object('state','rate_limited');
  else update public.secure_response_tokens set access_count=access_count+1 where id=token_row.id; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id;
  select * into staff from public.staff_profiles where organisation_id=recipient.organisation_id and id=recipient.staff_id;
  if token_row.revoked_at is not null or recipient.status in ('revoked','cancelled') or period.status='cancelled' or staff.employment_status='deactivated' then return jsonb_build_object('state','revoked'); end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then update public.availability_request_recipients set status='expired' where id=recipient.id and status not in ('submitted','responded','revoked','cancelled');return jsonb_build_object('state','expired'); end if;
  if recipient.status in ('sent','delivered','provider_accepted','manually_shared','ready') then update public.availability_request_recipients set status='opened',opened_at=coalesce(opened_at,now()) where id=recipient.id; end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,correlation_id,payload) values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability.opened',gen_random_uuid(),'{}');
  select jsonb_build_object('state',r.status,'starts_at',p.starts_at,'ends_at',p.ends_at,'deadline_at',p.deadline_at,'venue_name',v.name,'venue_timezone',v.timezone,'preferred_language',staff.preferred_language,'employee_name',coalesce(staff.first_name,split_part(staff.full_name,' ',1)),'entries',coalesce((select jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'availability',a.availability,'note',a.note) order by a.starts_at) from public.staff_availability a where a.request_recipient_id=r.id),'[]'::jsonb)) into result
  from public.availability_request_recipients r join public.availability_request_periods p on p.id=r.request_id join public.venues v on v.id=r.venue_id and v.organisation_id=r.organisation_id where r.id=recipient.id;
  return result;
end $$;

revoke all on function public.inspect_availability_request_v2(text) from public,authenticated;
grant execute on function public.inspect_availability_request_v2(text) to anon;

create or replace function public.invalidate_service_operation()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_row record; affected public.service_operations; affected_date date; reason text;
begin
  if tg_op='DELETE' then source_row:=old; else source_row:=new; end if;
  if tg_table_name='demand_forecasts' then reason:='demand_changed';affected_date:=source_row.trading_date;
  elsif tg_table_name='shifts' then reason:='roster_changed';affected_date:=source_row.starts_at::date;
  elsif tg_table_name='stock_counts' then reason:='inventory_changed';affected_date:=source_row.trading_date;
  elsif tg_table_name='normalized_sales' then reason:='pos_sales_changed';affected_date:=source_row.trading_date;
  elsif tg_table_name='time_records' then reason:='worked_hours_changed';affected_date:=source_row.clocked_in_at::date;
  elsif tg_table_name='reconciliation_runs' then reason:='reconciliation_changed';affected_date:=source_row.trading_date;
  elsif tg_table_name='closing_sessions' then reason:='close_changed';affected_date:=source_row.trading_date;
  else reason:='authoritative_input_changed';affected_date:=null;
  end if;
  for affected in select * from public.service_operations where organisation_id=source_row.organisation_id and venue_id=source_row.venue_id and service_date=affected_date and status not in ('locked','superseded')
  loop
    update public.service_operations set status='stale',stale_reasons=array(select distinct unnest(stale_reasons||array[reason])),updated_at=now() where id=affected.id;
    insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,payload)
      values(affected.organisation_id,affected.venue_id,'service_operation',affected.id,'service_operation.invalidated',jsonb_build_object('reason',reason,'source_table',tg_table_name,'source_id',source_row.id));
  end loop;
  return source_row;
end $$;

commit;
