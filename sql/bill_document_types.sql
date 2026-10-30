alter table public.electricity_bills add column if not exists bill_type text not null default 'FIT' check (bill_type in ('FIT','CONSUMPTION'));
alter table public.electricity_bills add column if not exists consumption_amount numeric;
alter table public.electricity_bills add column if not exists consumption_kwh numeric;
