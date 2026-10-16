begin;

-- Object-creation defaults may grant API roles broader privileges than the
-- workflow boundaries intend. Reads remain protected by RLS; mutations must use
-- reviewed server or security-definer boundaries.
revoke all privileges on
  public.approval_requests,
  public.automation_rules,
  public.automation_runs,
  public.beverage_reconciliations,
  public.bottle_detections,
  public.bottle_scan_images,
  public.connector_registry,
  public.mapping_exceptions,
  public.normalized_sales,
  public.pos_imports,
  public.pos_rejected_rows,
  public.reconciliation_exception_decisions,
  public.reconciliation_exceptions,
  public.reconciliation_product_results,
  public.reconciliation_readiness_checks,
  public.reconciliation_runs,
  public.reconciliation_summaries,
  public.source_mappings,
  public.stock_count_lines,
  public.stock_counts,
  public.stock_locations,
  public.stock_movements
from anon, authenticated;

grant select on
  public.approval_requests,
  public.automation_rules,
  public.automation_runs,
  public.beverage_reconciliations,
  public.bottle_detections,
  public.bottle_scan_images,
  public.connector_registry,
  public.mapping_exceptions,
  public.normalized_sales,
  public.pos_imports,
  public.pos_rejected_rows,
  public.reconciliation_exception_decisions,
  public.reconciliation_exceptions,
  public.reconciliation_product_results,
  public.reconciliation_readiness_checks,
  public.reconciliation_runs,
  public.reconciliation_summaries,
  public.source_mappings,
  public.stock_count_lines,
  public.stock_counts,
  public.stock_locations,
  public.stock_movements
to authenticated;

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'add_close_line',
        'begin_reconciliation',
        'confirm_pos_mapping',
        'create_close_draft',
        'create_stock_count',
        'decide_reconciliation_exception',
        'has_venue_access',
        'post_stock_count',
        'prepare_reconciliation_close',
        'prevent_append_only_mutation',
        'record_stock_movement',
        'repair_reconciliation_close_preparation',
        'submit_stock_count',
        'transition_close'
      ])
  loop
    execute format('revoke all privileges on function %s from public, anon', target_function);
  end loop;
end $$;

commit;
