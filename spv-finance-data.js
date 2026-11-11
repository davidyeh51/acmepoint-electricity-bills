(function (root) {
  'use strict';

  const SPV_DEFAULT_MODELS = [
    {
      id: 1,
      spv_code: 'CK-SPV',
      spv_name: '建坤能源股份有限公司',
      spv_tax_id: '96830692',
      plant_code: 'CCK001',
      site_name: 'CCK001 高振實業',
      electric_number: '11-71-0067-91-9',
      contract_number: '11-PV-115-0133',
      city: '高雄市',
      district: '湖內區',
      plant_location: '高雄市湖內區民生街121、123、125、125-1、125-2、125-3、127、129、129-1、129-2號',
      capacity_kwp: 1358.14,
      cod_date: '2026-05-11',
      tracking_start_date: '2026-05-11',
      tracking_end_date: '2027-04-30',
      target_daily_yield: 3.55,
      annual_degradation_rate: 0.004,
      fit_rate: 3.6559,
      provisional_trial_rate: 2.92,
      ppa_share: 0.8,
      ppa_rate: 5.0,
      vat_rate: 0.05,
      assumptions_json: {
        template_version: 'duck-v1',
        investment_model_source: '光伏電廠財務模型_台灣會計稅務範本 duck v1.xlsx',
        actual_fit_rate: 3.729,
        unit_capex_untaxed: 56250,
        extra_capex_untaxed: 0,
        om_mode: 'fixed_per_kwp',
        om_unit_y1_5: 445,
        om_unit_y6_10: 500,
        om_unit_y11_15: 550,
        om_unit_y16_20: 610,
        om_unit_y1_15: 445,
        om_pct_revenue: 0,
        rent_mode: 'fixed_annual',
        rent_pct_revenue: 0,
        rent_fixed_annual: 850000,
        rent_growth_rate: 0,
        insurance_rate_capex: 0.0045,
        spv_labor_fee_annual: 50000,
        spv_service_per_kwp: 204,
        module_recycle_per_kwp: 100,
        other_annual_opex: 0,
        meter_rental_monthly: 983,
        loan_ratio: 0.75,
        loan_interest_rate: 0.025,
        loan_years: 15,
        loan_method: 'principal_equal',
        project_years: 20,
        acct_dep_years: 20,
        tax_dep_years: 15,
        vat_deductible_pct: 1,
        discount_rate: 0.06,
        tax_rate: 0.20,
        decommission_per_kwp: 1000,
        dscr_target: 1.2,
        standard_monthly_shares: {
          '1': 0.0681, '2': 0.0787, '3': 0.0906, '4': 0.0958,
          '5': 0.1043, '6': 0.0950, '7': 0.0905, '8': 0.0868,
          '9': 0.0856, '10': 0.0758, '11': 0.0679, '12': 0.0609
        },
        investment_baseline: {
          template_version: 'duck-v1',
          capacity_kwp: 1358.14,
          target_daily_yield: 3.55,
          annual_degradation_rate: 0.004,
          ppa_share: 0.8,
          ppa_rate: 5.0,
          fit_rate: 3.6559,
          vat_rate: 0.05,
          unit_capex_untaxed: 56250,
          extra_capex_untaxed: 0,
          om_mode: 'fixed_per_kwp',
          om_unit_y1_5: 445,
          om_unit_y6_10: 500,
          om_unit_y11_15: 550,
          om_unit_y16_20: 610,
          om_pct_revenue: 0,
          rent_mode: 'fixed_annual',
          rent_fixed_annual: 850000,
          rent_growth_rate: 0,
          rent_pct_revenue: 0,
          insurance_rate_capex: 0.0045,
          spv_labor_fee_annual: 50000,
          spv_service_per_kwp: 204,
          module_recycle_per_kwp: 100,
          other_annual_opex: 0,
          loan_ratio: 0.75,
          loan_interest_rate: 0.025,
          loan_years: 15,
          loan_method: 'principal_equal',
          project_years: 20,
          acct_dep_years: 20,
          tax_dep_years: 15,
          vat_deductible_pct: 1,
          discount_rate: 0.06,
          tax_rate: 0.20,
          decommission_per_kwp: 1000,
          dscr_target: 1.2
        }
      },
      notes: '建坤 SPV 首座追蹤案場（CCK001 高振實業）；投資原案財模採 duck v1（CAPEX 56,250/kWp、80% PPA 5.00 + 20% FIT 3.6559、固定年租 85 萬、4 段維運 445/500/550/610）；2026-05-11 併聯試運轉（2.92），2026-08-13 轉商業躉購（FIT 3.729），累計 5 張台電通知單已核對。'
    }
  ];

  const SPV_DEFAULT_MONTHLY_RECORDS = [
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-05',
      period_start: '2026-05-11', period_end: '2026-05-31', days: 21,
      monthly_share_pct: 0.070655, predicted_kwh: 124339,
      report_actual_kwh: 126805, taipower_billed_kwh: 126805,
      taipower_bill_months: '115年07月 (試運轉併入6月單)',
      bill_purchase_amount: 370271, bill_settlement_amount: 0,
      bill_tax_amount: 18514, bill_meter_rental_amount: -688, bill_net_payable_amount: 388097,
      remark: '*未滿一個月(5/11併聯試運轉，併入115/07通知單)', source: 'EXCEL_AND_TAIPOWER'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-06',
      period_start: '2026-06-01', period_end: '2026-06-30', days: 30,
      monthly_share_pct: 0.095000, predicted_kwh: 167182,
      report_actual_kwh: 181149, taipower_billed_kwh: 181149,
      taipower_bill_months: '115年07月 (307,954 kWh)',
      bill_purchase_amount: 528955, bill_settlement_amount: 0,
      bill_tax_amount: 26447, bill_meter_rental_amount: -983, bill_net_payable_amount: 554419,
      remark: '含5月試運轉合計307,954度，暫以2.92元計價', source: 'EXCEL_AND_TAIPOWER'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-07',
      period_start: '2026-07-01', period_end: '2026-07-31', days: 31,
      monthly_share_pct: 0.090500, predicted_kwh: 159263,
      report_actual_kwh: 197794, taipower_billed_kwh: 197171,
      taipower_bill_months: '115年08月 (0701-0731)',
      bill_purchase_amount: 575739, bill_settlement_amount: 0,
      bill_tax_amount: 28787, bill_meter_rental_amount: -983, bill_net_payable_amount: 603543,
      remark: '月報表與台電抄表跨月差 -623 kWh (與8月 +623 kWh 抵銷平帳)', source: 'EXCEL_AND_TAIPOWER'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-08',
      period_start: '2026-08-01', period_end: '2026-08-31', days: 31,
      monthly_share_pct: 0.086800, predicted_kwh: 152751,
      report_actual_kwh: 135557, taipower_billed_kwh: 136180,
      taipower_bill_months: '115年08月(0801-12)＋115年09月(0813-31)',
      bill_purchase_amount: 507815, bill_settlement_amount: 408647,
      bill_tax_amount: 45823, bill_meter_rental_amount: -982, bill_net_payable_amount: 961303,
      remark: '8/13正式轉商業躉購(3.729)並補結算5/11–7/31計505,125度差額408,647元；跨月差 +623 kWh', source: 'EXCEL_AND_TAIPOWER'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-09',
      period_start: '2026-09-01', period_end: '2026-09-30', days: 30,
      monthly_share_pct: 0.085600, predicted_kwh: 150640,
      report_actual_kwh: 189772, taipower_billed_kwh: 189772,
      taipower_bill_months: '115年10月 (0901-0930)',
      bill_purchase_amount: 707660, bill_settlement_amount: 0,
      bill_tax_amount: 35383, bill_meter_rental_amount: -983, bill_net_payable_amount: 742060,
      remark: '首個完整商業運轉月份，達成率 125.98%', source: 'EXCEL_AND_TAIPOWER'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-10',
      period_start: '2026-10-01', period_end: '2026-10-31', days: 31,
      monthly_share_pct: 0.075800, predicted_kwh: 133394,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 115年11月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-11',
      period_start: '2026-11-01', period_end: '2026-11-30', days: 30,
      monthly_share_pct: 0.067900, predicted_kwh: 119491,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 115年12月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2026-12',
      period_start: '2026-12-01', period_end: '2026-12-31', days: 31,
      monthly_share_pct: 0.060900, predicted_kwh: 107172,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 116年01月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2027-01',
      period_start: '2027-01-01', period_end: '2027-01-31', days: 31,
      monthly_share_pct: 0.068100, predicted_kwh: 119843,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 116年02月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2027-02',
      period_start: '2027-02-01', period_end: '2027-02-28', days: 28,
      monthly_share_pct: 0.078700, predicted_kwh: 138497,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 116年03月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2027-03',
      period_start: '2027-03-01', period_end: '2027-03-31', days: 31,
      monthly_share_pct: 0.090600, predicted_kwh: 159439,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 116年04月 通知單匯入', source: 'EXCEL_FORECAST'
    },
    {
      plant_model_id: 1, electric_number: '11-71-0067-91-9', tracking_year_month: '2027-04',
      period_start: '2027-04-01', period_end: '2027-04-30', days: 30,
      monthly_share_pct: 0.095800, predicted_kwh: 168590,
      report_actual_kwh: null, taipower_billed_kwh: null,
      taipower_bill_months: null, bill_purchase_amount: null, bill_settlement_amount: null,
      bill_tax_amount: null, bill_meter_rental_amount: null, bill_net_payable_amount: null,
      remark: '待台電 116年05月 通知單匯入', source: 'EXCEL_FORECAST'
    }
  ];

  root.SPV_DEFAULT_MODELS = SPV_DEFAULT_MODELS;
  root.SPV_DEFAULT_MONTHLY_RECORDS = SPV_DEFAULT_MONTHLY_RECORDS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SPV_DEFAULT_MODELS, SPV_DEFAULT_MONTHLY_RECORDS };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
