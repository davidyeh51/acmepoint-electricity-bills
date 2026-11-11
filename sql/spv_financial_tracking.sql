-- Schema migration for Jiankun SPV Solar Plant Financial Tracking
-- Applied to Supabase project cowljafosekwvxithwjd as migration: spv_financial_tracking

CREATE OR REPLACE FUNCTION public.set_spv_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.spv_plant_models (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spv_code text NOT NULL DEFAULT 'CK-SPV',
  spv_name text NOT NULL DEFAULT '建坤能源股份有限公司',
  spv_tax_id text NOT NULL DEFAULT '96830692',
  plant_code text NOT NULL,
  site_name text NOT NULL,
  electric_number text NOT NULL UNIQUE,
  contract_number text,
  city text,
  district text,
  plant_location text,
  capacity_kwp numeric(12,4) NOT NULL CHECK (capacity_kwp > 0),
  cod_date date NOT NULL,
  tracking_start_date date NOT NULL,
  tracking_end_date date NOT NULL,
  target_daily_yield numeric(8,4) NOT NULL DEFAULT 3.55,
  annual_degradation_rate numeric(8,6) NOT NULL DEFAULT 0.004,
  fit_rate numeric(10,4) NOT NULL,
  provisional_trial_rate numeric(10,4),
  ppa_share numeric(6,4) NOT NULL DEFAULT 0 CHECK (ppa_share >= 0 AND ppa_share <= 1),
  ppa_rate numeric(10,4) NOT NULL DEFAULT 0,
  vat_rate numeric(6,4) NOT NULL DEFAULT 0.05,
  assumptions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_spv_plant_models_spv_code
  ON public.spv_plant_models (spv_code);

CREATE TRIGGER trg_spv_plant_models_updated_at
  BEFORE UPDATE ON public.spv_plant_models
  FOR EACH ROW
  EXECUTE FUNCTION public.set_spv_updated_at();

CREATE TABLE IF NOT EXISTS public.spv_monthly_tracking (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plant_model_id bigint NOT NULL REFERENCES public.spv_plant_models(id) ON DELETE CASCADE,
  electric_number text NOT NULL,
  tracking_year_month text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  days integer NOT NULL CHECK (days > 0),
  monthly_share_pct numeric(10,6) NOT NULL CHECK (monthly_share_pct >= 0 AND monthly_share_pct <= 1),
  predicted_kwh integer NOT NULL CHECK (predicted_kwh >= 0),
  report_actual_kwh integer,
  taipower_billed_kwh integer,
  taipower_bill_months text,
  bill_purchase_amount numeric(14,2),
  bill_settlement_amount numeric(14,2),
  bill_tax_amount numeric(14,2),
  bill_meter_rental_amount numeric(14,2),
  bill_net_payable_amount numeric(14,2),
  opex_actual_override numeric(14,2),
  remark text,
  source text NOT NULL DEFAULT 'EXCEL_AND_TAIPOWER',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_spv_monthly_tracking_plant_ym UNIQUE (plant_model_id, tracking_year_month)
);

CREATE INDEX IF NOT EXISTS idx_spv_monthly_tracking_electric_ym
  ON public.spv_monthly_tracking (electric_number, tracking_year_month);

CREATE TRIGGER trg_spv_monthly_tracking_updated_at
  BEFORE UPDATE ON public.spv_monthly_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.set_spv_updated_at();

ALTER TABLE public.spv_plant_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spv_monthly_tracking ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.spv_plant_models FROM anon;
REVOKE ALL ON public.spv_monthly_tracking FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spv_plant_models TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spv_monthly_tracking TO authenticated;

CREATE POLICY spv_plant_models_members_read
  ON public.spv_plant_models FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_plant_models_members_insert
  ON public.spv_plant_models FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_plant_models_members_update
  ON public.spv_plant_models FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_plant_models_admin_delete
  ON public.spv_plant_models FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active AND m.role = 'admin'
  ));

CREATE POLICY spv_monthly_tracking_members_read
  ON public.spv_monthly_tracking FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_monthly_tracking_members_insert
  ON public.spv_monthly_tracking FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_monthly_tracking_members_update
  ON public.spv_monthly_tracking FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active
  ));

CREATE POLICY spv_monthly_tracking_admin_delete
  ON public.spv_monthly_tracking FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bill_app_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active AND m.role = 'admin'
  ));
