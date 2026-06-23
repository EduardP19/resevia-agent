-- Replace quota-based token plans with API spend monitoring.
--
-- AI token rows are kept because provider billing is token-based. The removed
-- pieces are the product-plan allowance fields and the "used vs limit" view.

drop view if exists public.salon_token_usage_current_month;

alter table public.business_profiles
  drop column if exists monthly_token_limit,
  drop column if exists plan;

create index if not exists sms_messages_salon_created_at_idx
  on public.sms_messages(salon_id, created_at);

comment on table public.token_usage is
  'AI API usage ledger used to estimate tenant spend from input and output tokens.';
comment on column public.token_usage.tokens_prompt is
  'AI API input tokens for this interaction.';
comment on column public.token_usage.tokens_completion is
  'AI API output tokens for this interaction.';
comment on column public.token_usage.tokens_total is
  'Total AI API tokens reported by the provider for this interaction.';
comment on table public.sms_messages is
  'Twilio SMS ledger used to monitor tenant inbound and outbound message spend.';
