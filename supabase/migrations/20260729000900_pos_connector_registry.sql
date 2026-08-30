begin;

insert into public.connector_registry(
  connector_key,
  connector_kind,
  display_name,
  minimum_scopes,
  supports_oauth,
  supports_webhooks,
  supports_incremental_polling,
  enabled
) values (
  'pos_csv',
  'pos',
  'Generic POS CSV',
  array[]::text[],
  false,
  false,
  false,
  true
)
on conflict(connector_key) do update set
  connector_kind = excluded.connector_kind,
  display_name = excluded.display_name,
  minimum_scopes = excluded.minimum_scopes,
  supports_oauth = excluded.supports_oauth,
  supports_webhooks = excluded.supports_webhooks,
  supports_incremental_polling = excluded.supports_incremental_polling,
  enabled = excluded.enabled;

commit;
