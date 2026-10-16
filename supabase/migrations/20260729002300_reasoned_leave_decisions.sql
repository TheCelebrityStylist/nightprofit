begin;

create or replace function public.decide_staff_absence(
  target_organisation_id uuid,target_absence_id uuid,target_decision text,target_reason text
) returns public.staff_absences language plpgsql security definer set search_path='' as $$
declare absence public.staff_absences; affected jsonb;
begin
  select * into absence from public.staff_absences where organisation_id=target_organisation_id and id=target_absence_id for update;
  if absence.id is null or not public.has_capability(target_organisation_id,absence.venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if absence.absence_type<>'leave' or absence.status<>'requested' then raise exception 'invalid_absence_state'; end if;
  if target_decision not in('approved','rejected') or length(trim(target_reason))<5 then raise exception 'decision_reason_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('shift_id',id,'starts_at',starts_at,'ends_at',ends_at,'role_id',role_id,'status',status) order by starts_at),'[]'::jsonb)
    into affected from public.shifts where organisation_id=target_organisation_id and venue_id=absence.venue_id and staff_id=absence.staff_id and status not in('cancelled','rejected') and starts_at<absence.ends_at and ends_at>absence.starts_at;
  update public.staff_absences set status=target_decision,reviewed_by=auth.uid(),reviewed_at=now(),note=concat_ws(E'\n',nullif(note,''),'Manager decision: '||trim(target_reason)) where id=absence.id returning * into absence;
  update public.roster_proposals set status='stale' where organisation_id=target_organisation_id and venue_id=absence.venue_id and status='current' and window_start<absence.ends_at and window_end>absence.starts_at;
  perform public.append_operational_event(target_organisation_id,absence.venue_id,'staff_absence',absence.id,'leave.'||target_decision,jsonb_build_object('reason',trim(target_reason),'affected_shifts',affected),gen_random_uuid());
  if target_decision='approved' and jsonb_array_length(affected)>0 then
    insert into public.operating_actions(organisation_id,venue_id,action_key,action_type,title,rationale,why_it_matters,recommended_response,severity,status,due_at,evidence_refs,evidence_completeness_basis_points,effort_points,rank_score)
      values(target_organisation_id,absence.venue_id,'leave-coverage:'||absence.id,'leave_decision','Resolve approved leave coverage',jsonb_array_length(affected)||' published or planned shift(s) overlap approved leave.','The roster must be replaced through a controlled successor version.','Open the affected shifts, choose eligible replacements, then publish a successor.','high','open',absence.starts_at,affected,10000,2,780000)
      on conflict(organisation_id,action_key) do update set rationale=excluded.rationale,evidence_refs=excluded.evidence_refs,status='open',updated_at=now();
  end if;
  return absence;
end $$;

revoke all on function public.decide_staff_absence(uuid,uuid,text,text) from public,anon;
grant execute on function public.decide_staff_absence(uuid,uuid,text,text) to authenticated;

commit;
