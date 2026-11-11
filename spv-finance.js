(function (root) {
  'use strict';

  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(v, decimals = 0) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function fmtCurrency(v) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    const n = Math.round(Number(v));
    const sign = n < 0 ? '-' : '';
    return `${sign}NT$ ${Math.abs(n).toLocaleString('en-US')}`;
  }

  function fmtPct(v, decimals = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    return `${(Number(v) * 100).toFixed(decimals)}%`;
  }

  function calcTaiwanCorporateIncomeTax(taxableIncome) {
    if (!Number.isFinite(taxableIncome) || taxableIncome <= 120000) return 0;
    if (taxableIncome <= 200000) {
      return Math.min((taxableIncome - 120000) * 0.5, taxableIncome * 0.2);
    }
    return taxableIncome * 0.2;
  }

  function computeIRR(cashFlows) {
    if (!Array.isArray(cashFlows) || cashFlows.length < 2) return null;
    let hasPos = false;
    let hasNeg = false;
    for (const c of cashFlows) {
      if (c > 0) hasPos = true;
      if (c < 0) hasNeg = true;
    }
    if (!hasPos || !hasNeg) return null;

    const npv = (rate) => {
      let sum = 0;
      for (let t = 0; t < cashFlows.length; t++) {
        sum += cashFlows[t] / Math.pow(1 + rate, t);
      }
      return sum;
    };

    let lo = -0.5;
    let hi = 2.0;
    let fLo = npv(lo);
    let fHi = npv(hi);
    let expand = 0;
    while (fLo * fHi > 0 && expand < 10) {
      hi *= 1.5;
      fHi = npv(hi);
      expand++;
    }
    if (fLo * fHi > 0) return null;

    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid);
      if (Math.abs(fMid) < 1e-4) return mid;
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
    }
    return (lo + hi) / 2;
  }

  function computePaybackYears(cumCashFlows) {
    if (!Array.isArray(cumCashFlows) || cumCashFlows.length < 2) return null;
    for (let t = 1; t < cumCashFlows.length; t++) {
      if (cumCashFlows[t] >= 0) {
        const prev = cumCashFlows[t - 1];
        const curr = cumCashFlows[t];
        const span = curr - prev;
        if (prev < 0 && span > 0) {
          return (t - 1) + (-prev / span);
        }
        return t;
      }
    }
    return null;
  }

  function mergeAssumptions(model) {
    const a = (model && model.assumptions_json) || {};
    return {
      template_version: a.template_version || 'v1.2',
      unit_capex_untaxed: Number(a.unit_capex_untaxed ?? 51500),
      extra_capex_untaxed: Number(a.extra_capex_untaxed ?? 0),
      om_mode: a.om_mode || 'fixed_per_kwp',
      om_unit_y1_15: Number(a.om_unit_y1_15 ?? 350),
      om_unit_y16_20: Number(a.om_unit_y16_20 ?? 600),
      om_pct_revenue: Number(a.om_pct_revenue ?? 0.08),
      rent_mode: a.rent_mode || 'pct_revenue',
      rent_pct_revenue: Number(a.rent_pct_revenue ?? 0.10),
      rent_fixed_annual: Number(a.rent_fixed_annual ?? 0),
      rent_growth_rate: Number(a.rent_growth_rate ?? 0),
      insurance_rate_capex: Number(a.insurance_rate_capex ?? 0.0045),
      spv_labor_fee_annual: Number(a.spv_labor_fee_annual ?? 50000),
      spv_service_per_kwp: Number(a.spv_service_per_kwp ?? 204),
      module_recycle_per_kwp: Number(a.module_recycle_per_kwp ?? 100),
      other_annual_opex: Number(a.other_annual_opex ?? 0),
      meter_rental_monthly: Number(a.meter_rental_monthly ?? 983),
      loan_ratio: Number(a.loan_ratio ?? 0.75),
      loan_interest_rate: Number(a.loan_interest_rate ?? 0.025),
      loan_years: Number(a.loan_years ?? 15),
      loan_method: a.loan_method || 'principal_equal',
      project_years: Number(a.project_years ?? 20),
      acct_dep_years: Number(a.acct_dep_years ?? 20),
      tax_dep_years: Number(a.tax_dep_years ?? 15),
      vat_deductible_pct: Number(a.vat_deductible_pct ?? 1),
      discount_rate: Number(a.discount_rate ?? 0.06),
      tax_rate: Number(a.tax_rate ?? 0.20),
      decommission_per_kwp: Number(a.decommission_per_kwp ?? 1000),
      dscr_target: Number(a.dscr_target ?? 1.2),
      other_annual_income: Number(a.other_annual_income ?? 0)
    };
  }

  function compute20YearFinancialModel(model) {
    const cap = Number(model.capacity_kwp || 0);
    const dy = Number(model.target_daily_yield || 3.55);
    const deg = Number(model.annual_degradation_rate ?? 0.004);
    const ppaShare = Math.min(1, Math.max(0, Number(model.ppa_share || 0)));
    const fitShare = 1 - ppaShare;
    const ppaRate = Number(model.ppa_rate || 0);
    const fitRate = Number(model.fit_rate || 0);
    const vatRate = Number(model.vat_rate ?? 0.05);
    const a = mergeAssumptions(model);

    const capexUntaxed = cap * a.unit_capex_untaxed + a.extra_capex_untaxed;
    const capexVat = capexUntaxed * vatRate;
    const capexTotalCash = capexUntaxed + capexVat;
    const loanAmount = capexUntaxed * a.loan_ratio;
    const equityY0 = capexTotalCash - loanAmount;

    const projectYears = Math.max(1, Math.min(30, Math.round(a.project_years)));
    const loanYears = Math.max(0, Math.min(projectYears, Math.round(a.loan_years)));
    const acctDepYears = Math.max(1, Math.round(a.acct_dep_years));
    const taxDepYears = Math.max(1, Math.round(a.tax_dep_years));

    const annualDebtPaymentAnnuity = (loanYears > 0 && loanAmount > 0 && a.loan_interest_rate > 0)
      ? loanAmount * (a.loan_interest_rate * Math.pow(1 + a.loan_interest_rate, loanYears)) / (Math.pow(1 + a.loan_interest_rate, loanYears) - 1)
      : (loanYears > 0 ? loanAmount / loanYears : 0);

    const years = [];
    const leveredSeries = [-equityY0];
    const unleveredSeries = [-capexTotalCash];
    const cumLeveredSeries = [-equityY0];
    const cumUnleveredSeries = [-capexTotalCash];

    years.push({
      year: 0,
      generation_kwh: 0,
      revenue_untaxed: 0,
      om_cost: 0,
      rent_cost: 0,
      insurance_cost: 0,
      spv_cost: 0,
      recycle_cost: 0,
      total_opex: 0,
      ebitda: 0,
      principal: 0,
      interest: 0,
      debt_service: 0,
      dscr: null,
      income_tax: 0,
      unlevered_cf: -capexTotalCash,
      levered_cf: -equityY0,
      cum_unlevered_cf: -capexTotalCash,
      cum_levered_cf: -equityY0,
      ending_loan: loanAmount
    });

    let openingLoan = loanAmount;
    // FIFO 10-year tax loss carryforward buckets { remaining, expiresYear }
    const lossBuckets = [];

    for (let y = 1; y <= projectYears; y++) {
      const genKwh = cap * dy * 365 * Math.pow(1 - deg, y - 1);
      const ppaRev = genKwh * ppaShare * ppaRate;
      const fitRev = genKwh * fitShare * fitRate;
      const revenueUntaxed = ppaRev + fitRev + a.other_annual_income;

      const omCost = a.om_mode === 'pct_revenue'
        ? revenueUntaxed * a.om_pct_revenue
        : cap * (y <= 15 ? a.om_unit_y1_15 : a.om_unit_y16_20);

      const rentCost = a.rent_mode === 'fixed_annual'
        ? a.rent_fixed_annual * Math.pow(1 + a.rent_growth_rate, y - 1)
        : revenueUntaxed * a.rent_pct_revenue;

      const insuranceCost = capexUntaxed * a.insurance_rate_capex;
      const spvCost = a.spv_labor_fee_annual + cap * a.spv_service_per_kwp + a.other_annual_opex;
      const recycleCost = y <= 20 ? cap * a.module_recycle_per_kwp : 0;
      const totalOpex = omCost + rentCost + insuranceCost + spvCost + recycleCost;
      const ebitda = revenueUntaxed - totalOpex;

      const taxDep = y <= taxDepYears ? capexUntaxed / taxDepYears : 0;
      let interest = 0;
      let principal = 0;
      if (y <= loanYears && openingLoan > 0) {
        interest = openingLoan * a.loan_interest_rate;
        if (a.loan_method === 'annuity') {
          principal = Math.min(openingLoan, annualDebtPaymentAnnuity - interest);
        } else {
          principal = Math.min(openingLoan, loanAmount / loanYears);
        }
      }
      const endingLoan = Math.max(0, openingLoan - principal);
      const debtService = principal + interest;
      const dscr = debtService > 0 ? ebitda / debtService : null;

      // Levered taxable income with 10-yr loss carryforward
      const taxableBeforeLoss = ebitda - taxDep - interest;
      let taxableAfterLoss = 0;
      if (taxableBeforeLoss < 0) {
        lossBuckets.push({ remaining: -taxableBeforeLoss, expiresYear: y + 10 });
      } else if (taxableBeforeLoss > 0) {
        let avail = taxableBeforeLoss;
        for (const b of lossBuckets) {
          if (b.expiresYear >= y && b.remaining > 0 && avail > 0) {
            const used = Math.min(b.remaining, avail);
            b.remaining -= used;
            avail -= used;
          }
        }
        taxableAfterLoss = avail;
      }
      const leveredTax = a.tax_rate === 0.20
        ? calcTaiwanCorporateIncomeTax(taxableAfterLoss)
        : Math.max(0, taxableAfterLoss * a.tax_rate);

      // Unlevered tax
      const unleveredTaxable = Math.max(0, ebitda - taxDep);
      const unleveredTax = a.tax_rate === 0.20
        ? calcTaiwanCorporateIncomeTax(unleveredTaxable)
        : unleveredTaxable * a.tax_rate;

      const vatRecovery = y === 1 ? capexVat * a.vat_deductible_pct : 0;
      const decommissionCf = y === projectYears ? -(cap * a.decommission_per_kwp) : 0;

      const unleveredCf = ebitda - unleveredTax + vatRecovery + decommissionCf;
      const leveredCf = ebitda - debtService - leveredTax + vatRecovery + decommissionCf;

      const prevCumUnlev = cumUnleveredSeries[cumUnleveredSeries.length - 1];
      const prevCumLev = cumLeveredSeries[cumLeveredSeries.length - 1];
      const cumUnleveredCf = prevCumUnlev + unleveredCf;
      const cumLeveredCf = prevCumLev + leveredCf;

      unleveredSeries.push(unleveredCf);
      leveredSeries.push(leveredCf);
      cumUnleveredSeries.push(cumUnleveredCf);
      cumLeveredSeries.push(cumLeveredCf);

      years.push({
        year: y,
        generation_kwh: genKwh,
        revenue_untaxed: revenueUntaxed,
        om_cost: omCost,
        rent_cost: rentCost,
        insurance_cost: insuranceCost,
        spv_cost: spvCost,
        recycle_cost: recycleCost,
        total_opex: totalOpex,
        ebitda,
        principal,
        interest,
        debt_service: debtService,
        dscr,
        income_tax: leveredTax,
        unlevered_cf: unleveredCf,
        levered_cf: leveredCf,
        cum_unlevered_cf: cumUnleveredCf,
        cum_levered_cf: cumLeveredCf,
        ending_loan: endingLoan
      });

      openingLoan = endingLoan;
    }

    const totalGeneration = years.slice(1).reduce((s, r) => s + r.generation_kwh, 0);
    const totalRevenue = years.slice(1).reduce((s, r) => s + r.revenue_untaxed, 0);
    const totalEbitda = years.slice(1).reduce((s, r) => s + r.ebitda, 0);
    const totalLeveredCf = years.reduce((s, r) => s + r.levered_cf, 0);
    const debtYears = years.filter(r => r.dscr !== null);
    const minDscr = debtYears.length ? Math.min(...debtYears.map(r => r.dscr)) : null;

    let projectNpv = 0;
    for (let t = 0; t < unleveredSeries.length; t++) {
      projectNpv += unleveredSeries[t] / Math.pow(1 + a.discount_rate, t);
    }

    return {
      assumptions: a,
      capex_untaxed: capexUntaxed,
      capex_vat: capexVat,
      capex_total_cash: capexTotalCash,
      loan_amount: loanAmount,
      equity_y0: equityY0,
      weighted_tariff: ppaShare * ppaRate + fitShare * fitRate,
      year1: years[1],
      min_dscr: minDscr,
      project_irr: computeIRR(unleveredSeries),
      equity_irr: computeIRR(leveredSeries),
      project_npv: projectNpv,
      project_payback_years: computePaybackYears(cumUnleveredSeries),
      equity_payback_years: computePaybackYears(cumLeveredSeries),
      total_generation_kwh: totalGeneration,
      total_revenue_untaxed: totalRevenue,
      total_ebitda: totalEbitda,
      total_levered_cf: totalLeveredCf,
      years
    };
  }

  function reconcileSpvMonthlyTracking(model, rawMonthlyRows, allBills) {
    const cap = Number(model.capacity_kwp || 0);
    const dy = Number(model.target_daily_yield || 3.55);
    const fitRate = Number(model.fit_rate || 3.729);
    const ppaShare = Math.min(1, Math.max(0, Number(model.ppa_share || 0)));
    const weightedTariff = ppaShare * Number(model.ppa_rate || 0) + (1 - ppaShare) * fitRate;
    const fin = compute20YearFinancialModel(model);
    const y1 = fin.year1;
    // Monthly fixed OPEX component allocated by days / 365
    const fixedAnnualOpex = y1.om_cost + y1.insurance_cost + y1.spv_cost + y1.recycle_cost +
      (fin.assumptions.rent_mode === 'fixed_annual' ? y1.rent_cost : 0);

    const plantBills = (allBills || [])
      .filter(b => b.electric_number === model.electric_number && b.bill_type !== 'CONSUMPTION')
      .slice()
      .sort((a, b) => String(a.billing_start_ad || '').localeCompare(String(b.billing_start_ad || '')));

    const rows = (rawMonthlyRows || [])
      .filter(r => !r.electric_number || r.electric_number === model.electric_number)
      .slice()
      .sort((a, b) => String(a.tracking_year_month).localeCompare(String(b.tracking_year_month)))
      .map(r => {
        const share = Number(r.monthly_share_pct || 0);
        // When DY matches base Excel DY (within 0.0001), keep stored predicted_kwh; else recalculate proportionally
        const calcPred = Math.round(cap * dy * 365 * share);
        const predictedKwh = (Math.abs(dy - 3.55) < 0.0001 && r.predicted_kwh != null)
          ? Number(r.predicted_kwh)
          : calcPred;

        let reportActualKwh = r.report_actual_kwh != null ? Number(r.report_actual_kwh) : null;
        let billedKwh = r.taipower_billed_kwh != null ? Number(r.taipower_billed_kwh) : null;
        let billMonths = r.taipower_bill_months || null;
        let purchaseAmt = r.bill_purchase_amount != null ? Number(r.bill_purchase_amount) : null;
        let settlementAmt = r.bill_settlement_amount != null ? Number(r.bill_settlement_amount) : null;
        let taxAmt = r.bill_tax_amount != null ? Number(r.bill_tax_amount) : null;
        let rentalAmt = r.bill_meter_rental_amount != null ? Number(r.bill_meter_rental_amount) : null;
        let netAmt = r.bill_net_payable_amount != null ? Number(r.bill_net_payable_amount) : null;
        let autoMatchedFromBills = false;

        // Auto-link any newly uploaded bills (e.g. >= 2026-10) whose billing_start_ad falls into this tracking month
        if (billedKwh === null) {
          const matchingNewBills = plantBills.filter(b => {
            const start = String(b.billing_start_ad || '');
            return start.slice(0, 7) === r.tracking_year_month && b.status === 'PARSED';
          });
          if (matchingNewBills.length > 0) {
            autoMatchedFromBills = true;
            billedKwh = matchingNewBills.reduce((s, b) => s + Number(b.total_kwh || 0), 0);
            purchaseAmt = matchingNewBills.reduce((s, b) => s + Number(b.purchase_amount || 0), 0);
            settlementAmt = 0;
            taxAmt = matchingNewBills.reduce((s, b) => s + Number(b.tax_amount || 0), 0);
            rentalAmt = matchingNewBills.reduce((s, b) => s + Number(b.meter_rental_amount || 0), 0);
            netAmt = matchingNewBills.reduce((s, b) => s + Number(b.net_payable_amount || 0), 0);
            billMonths = matchingNewBills.map(b => b.bill_year_month || b.bill_year_month_ad).join('＋');
            if (reportActualKwh === null) {
              reportActualKwh = billedKwh;
            }
          }
        }

        const effectiveActualKwh = reportActualKwh !== null ? reportActualKwh : billedKwh;
        const achievementRate = (effectiveActualKwh !== null && predictedKwh > 0)
          ? effectiveActualKwh / predictedKwh
          : null;
        const actualDmy = (effectiveActualKwh !== null && cap > 0 && r.days > 0)
          ? effectiveActualKwh / (cap * Number(r.days))
          : null;
        const billReportDiffKwh = (billedKwh !== null && reportActualKwh !== null)
          ? billedKwh - reportActualKwh
          : null;

        const totalBilledUntaxed = (purchaseAmt !== null || settlementAmt !== null)
          ? Number(purchaseAmt || 0) + Number(settlementAmt || 0)
          : null;

        const accrualRevenueUntaxed = effectiveActualKwh !== null
          ? effectiveActualKwh * weightedTariff
          : null;
        const forecastRevenueUntaxed = predictedKwh * weightedTariff;
        const revenueBase = totalBilledUntaxed !== null
          ? totalBilledUntaxed
          : (accrualRevenueUntaxed !== null ? accrualRevenueUntaxed : forecastRevenueUntaxed);

        const rentCost = fin.assumptions.rent_mode === 'pct_revenue'
          ? revenueBase * fin.assumptions.rent_pct_revenue
          : 0;
        const fixedCostSlice = fixedAnnualOpex * (Number(r.days) / 365);
        const estOpex = r.opex_actual_override != null
          ? Number(r.opex_actual_override)
          : fixedCostSlice + rentCost;
        const estEbitda = revenueBase - estOpex;

        return {
          ...r,
          predicted_kwh: predictedKwh,
          report_actual_kwh: reportActualKwh,
          taipower_billed_kwh: billedKwh,
          taipower_bill_months: billMonths,
          bill_purchase_amount: purchaseAmt,
          bill_settlement_amount: settlementAmt,
          bill_tax_amount: taxAmt,
          bill_meter_rental_amount: rentalAmt,
          bill_net_payable_amount: netAmt,
          total_billed_untaxed: totalBilledUntaxed,
          accrual_revenue_untaxed: accrualRevenueUntaxed,
          forecast_revenue_untaxed: forecastRevenueUntaxed,
          effective_actual_kwh: effectiveActualKwh,
          achievement_rate: achievementRate,
          actual_dmy: actualDmy,
          bill_report_diff_kwh: billReportDiffKwh,
          est_opex: estOpex,
          est_ebitda: estEbitda,
          auto_matched_from_bills: autoMatchedFromBills
        };
      });

    const actualRows = rows.filter(r => r.effective_actual_kwh !== null);
    const billedRows = rows.filter(r => r.taipower_billed_kwh !== null);

    const totalPredicted12m = rows.reduce((s, r) => s + r.predicted_kwh, 0);
    const totalPredictedToDate = actualRows.reduce((s, r) => s + r.predicted_kwh, 0);
    const totalReportActualToDate = actualRows.reduce((s, r) => s + Number(r.report_actual_kwh ?? r.effective_actual_kwh ?? 0), 0);
    const totalEffectiveActualToDate = actualRows.reduce((s, r) => s + Number(r.effective_actual_kwh || 0), 0);
    const totalActualDays = actualRows.reduce((s, r) => s + Number(r.days || 0), 0);
    const overallAchievement = totalPredictedToDate > 0 ? totalEffectiveActualToDate / totalPredictedToDate : null;
    const actualAvgDmy = (totalActualDays > 0 && cap > 0) ? totalEffectiveActualToDate / (cap * totalActualDays) : null;

    const totalBilledKwh = billedRows.reduce((s, r) => s + Number(r.taipower_billed_kwh || 0), 0);
    const totalBillPurchase = billedRows.reduce((s, r) => s + Number(r.bill_purchase_amount || 0), 0);
    const totalBillSettlement = billedRows.reduce((s, r) => s + Number(r.bill_settlement_amount || 0), 0);
    const totalBilledUntaxed = totalBillPurchase + totalBillSettlement;
    const totalBillTax = billedRows.reduce((s, r) => s + Number(r.bill_tax_amount || 0), 0);
    const totalBillRental = billedRows.reduce((s, r) => s + Number(r.bill_meter_rental_amount || 0), 0);
    const totalBillNetPayable = billedRows.reduce((s, r) => s + Number(r.bill_net_payable_amount || 0), 0);

    const remainingForecastKwh = rows
      .filter(r => r.effective_actual_kwh === null)
      .reduce((s, r) => s + r.predicted_kwh, 0);
    const projected12mConservativeKwh = totalEffectiveActualToDate + remainingForecastKwh;
    const projected12mRunRateKwh = overallAchievement !== null
      ? totalEffectiveActualToDate + Math.round(remainingForecastKwh * overallAchievement)
      : totalPredicted12m;

    const estOpexToDate = actualRows.reduce((s, r) => s + r.est_opex, 0);
    const estEbitdaToDate = totalBilledUntaxed - estOpexToDate;

    return {
      model,
      financial_model: fin,
      rows,
      linked_bills: plantBills,
      summary: {
        total_months: rows.length,
        actual_months_count: actualRows.length,
        billed_months_count: billedRows.length,
        total_predicted_12m: totalPredicted12m,
        total_predicted_to_date: totalPredictedToDate,
        total_report_actual_to_date: totalReportActualToDate,
        total_effective_actual_to_date: totalEffectiveActualToDate,
        total_actual_days: totalActualDays,
        overall_achievement: overallAchievement,
        actual_avg_dmy: actualAvgDmy,
        total_billed_kwh: totalBilledKwh,
        bill_vs_report_diff_kwh: totalBilledKwh - totalReportActualToDate,
        total_bill_purchase: totalBillPurchase,
        total_bill_settlement: totalBillSettlement,
        total_billed_untaxed: totalBilledUntaxed,
        accrual_revenue_to_date: totalEffectiveActualToDate * weightedTariff,
        total_bill_tax: totalBillTax,
        total_bill_rental: totalBillRental,
        total_bill_net_payable: totalBillNetPayable,
        projected_12m_conservative_kwh: projected12mConservativeKwh,
        projected_12m_run_rate_kwh: projected12mRunRateKwh,
        est_opex_to_date: estOpexToDate,
        est_ebitda_to_date: estEbitdaToDate,
        bills_raw_count: plantBills.length,
        bills_raw_kwh: plantBills.reduce((s, b) => s + Number(b.total_kwh || 0), 0),
        bills_raw_net_payable: plantBills.reduce((s, b) => s + Number(b.net_payable_amount || 0), 0)
      }
    };
  }

  function buildGenerationSvgChart(rows) {
    const W = 960;
    const H = 285;
    const padL = 62;
    const padR = 54;
    const padT = 26;
    const padB = 46;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxKwh = Math.max(
      100000,
      ...rows.map(r => Math.max(Number(r.predicted_kwh || 0), Number(r.effective_actual_kwh || 0)))
    ) * 1.12;
    const maxPct = Math.max(
      1.35,
      ...rows.map(r => (r.achievement_rate != null ? Number(r.achievement_rate) * 1.08 : 0))
    );

    const n = Math.max(1, rows.length);
    const slotW = plotW / n;
    const barW = Math.min(24, slotW * 0.34);

    let gridHtml = '';
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = padT + plotH * (1 - ratio);
      const val = Math.round((maxKwh * ratio) / 1000);
      gridHtml += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3,3" />`;
      gridHtml += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${val}k</text>`;
    }

    const y100 = padT + plotH * (1 - Math.min(1, 1.0 / maxPct));
    gridHtml += `<line x1="${padL}" y1="${y100.toFixed(1)}" x2="${W - padR}" y2="${y100.toFixed(1)}" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="5,4" />`;
    gridHtml += `<text x="${W - padR + 6}" y="${(y100 + 3.5).toFixed(1)}" font-size="10" font-weight="700" fill="#d97706">100%</text>`;

    let barsHtml = '';
    const linePts = [];

    rows.forEach((r, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const predH = (Number(r.predicted_kwh || 0) / maxKwh) * plotH;
      const predY = padT + plotH - predH;

      barsHtml += `<rect x="${(cx - barW - 2).toFixed(1)}" y="${predY.toFixed(1)}" width="${barW.toFixed(1)}" height="${predH.toFixed(1)}" rx="3" fill="#cbd5e1">` +
        `<title>${escHtml(r.tracking_year_month)} 預測：${fmtNum(r.predicted_kwh)} 度</title></rect>`;

      if (r.effective_actual_kwh !== null) {
        const actH = (Number(r.effective_actual_kwh) / maxKwh) * plotH;
        const actY = padT + plotH - actH;
        const beat = r.achievement_rate != null && r.achievement_rate >= 1;
        const fill = beat ? '#10b981' : '#6366f1';
        barsHtml += `<rect x="${(cx + 2).toFixed(1)}" y="${actY.toFixed(1)}" width="${barW.toFixed(1)}" height="${actH.toFixed(1)}" rx="3" fill="${fill}">` +
          `<title>${escHtml(r.tracking_year_month)} 實發：${fmtNum(r.effective_actual_kwh)} 度 (${fmtPct(r.achievement_rate)})</title></rect>`;

        if (r.achievement_rate !== null) {
          const py = padT + plotH * (1 - Math.min(1, r.achievement_rate / maxPct));
          linePts.push({ cx, py, r });
        }
      }

      barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${escHtml(r.tracking_year_month.slice(2))}</text>`;
      if (r.achievement_rate !== null) {
        const pctColor = r.achievement_rate >= 1 ? '#047857' : '#b45309';
        barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${pctColor}">${(r.achievement_rate * 100).toFixed(0)}%</text>`;
      }
    });

    let polyHtml = '';
    if (linePts.length > 0) {
      if (linePts.length > 1) {
        const d = linePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
        polyHtml += `<path d="${d}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round" />`;
      }
      linePts.forEach(p => {
        polyHtml += `<circle cx="${p.cx.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4" fill="#fff" stroke="#d97706" stroke-width="2.2">` +
          `<title>${escHtml(p.r.tracking_year_month)} 達成率：${fmtPct(p.r.achievement_rate)}</title></circle>`;
      });
    }

    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="建坤 SPV 12 個月發電預測與實績圖">${gridHtml}${barsHtml}${polyHtml}</svg>`;
  }

  const SpvFinance = {
    state: {
      loaded: false,
      loading: false,
      source: 'fallback',
      models: [],
      monthly: [],
      activeElectricNumber: '11-71-0067-91-9',
      draftAssumptions: null,
      draftTopFields: null,
      editingMonthKey: null
    },

    async load(force = false) {
      if (this.state.loading) return;
      if (this.state.loaded && !force) {
        this.render();
        return;
      }
      this.state.loading = true;
      try {
        let res = { models: [], monthly: [], source: 'fallback' };
        if (typeof SupabaseBillService !== 'undefined' && typeof SupabaseBillService.fetchSpvData === 'function') {
          res = await SupabaseBillService.fetchSpvData('CK-SPV');
        } else if (typeof window !== 'undefined' && Array.isArray(window.SPV_DEFAULT_MODELS)) {
          res = {
            models: JSON.parse(JSON.stringify(window.SPV_DEFAULT_MODELS)),
            monthly: JSON.parse(JSON.stringify(window.SPV_DEFAULT_MONTHLY_RECORDS || []))
          };
        }
        this.state.models = res.models || [];
        this.state.monthly = res.monthly || [];
        this.state.source = res.source || 'fallback';
        if (this.state.models.length && !this.state.models.some(m => m.electric_number === this.state.activeElectricNumber)) {
          this.state.activeElectricNumber = this.state.models[0].electric_number;
        }
        this.resetDraftFromActive();
        this.state.loaded = true;
      } catch (e) {
        console.warn('SpvFinance.load failed:', e);
      } finally {
        this.state.loading = false;
        this.render();
      }
    },

    getActiveModel() {
      const m = this.state.models.find(x => x.electric_number === this.state.activeElectricNumber) || this.state.models[0];
      if (!m) return null;
      if (this.state.draftAssumptions && this.state.draftTopFields) {
        return {
          ...m,
          ...this.state.draftTopFields,
          assumptions_json: { ...(m.assumptions_json || {}), ...this.state.draftAssumptions }
        };
      }
      return m;
    },

    resetDraftFromActive() {
      const base = this.state.models.find(x => x.electric_number === this.state.activeElectricNumber) || this.state.models[0];
      if (!base) return;
      this.state.draftTopFields = {
        target_daily_yield: Number(base.target_daily_yield || 3.55),
        fit_rate: Number(base.fit_rate || 3.729),
        ppa_share: Number(base.ppa_share || 0),
        ppa_rate: Number(base.ppa_rate || 0),
        annual_degradation_rate: Number(base.annual_degradation_rate ?? 0.004)
      };
      this.state.draftAssumptions = mergeAssumptions(base);
    },

    selectPlant(electricNumber) {
      this.state.activeElectricNumber = electricNumber;
      this.resetDraftFromActive();
      this.render();
    },

    onParamChange(field, value, isTopField = false) {
      if (!this.state.draftAssumptions || !this.state.draftTopFields) return;
      if (isTopField) {
        const num = Number(value);
        if (Number.isFinite(num)) this.state.draftTopFields[field] = num;
      } else if (field === 'om_mode' || field === 'rent_mode' || field === 'loan_method') {
        this.state.draftAssumptions[field] = value;
      } else {
        const num = Number(value);
        if (Number.isFinite(num)) this.state.draftAssumptions[field] = num;
      }
      this.render();
    },

    async saveParams() {
      const active = this.getActiveModel();
      if (!active) return;
      const btn = document.getElementById('spvSaveParamsBtn');
      if (btn) { btn.disabled = true; btn.textContent = '儲存中...'; }
      try {
        if (typeof SupabaseBillService !== 'undefined' && SupabaseBillService.saveSpvPlantModel) {
          const res = await SupabaseBillService.saveSpvPlantModel(active);
          const idx = this.state.models.findIndex(x => x.electric_number === active.electric_number);
          if (idx >= 0) {
            this.state.models[idx] = { ...this.state.models[idx], ...(res.data || active) };
          }
          this.resetDraftFromActive();
          this.render();
          if (typeof showToast === 'function') {
            showToast(res.synced ? '建坤 SPV 財模參數已儲存並同步至 Supabase！' : '建坤 SPV 財模參數已暫存於本機（登入後可雲端同步）。');
          }
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('儲存失敗：' + e.message, true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '儲存參數至 Supabase'; }
      }
    },

    resetToDefaultParams() {
      const defaults = (typeof window !== 'undefined' && Array.isArray(window.SPV_DEFAULT_MODELS)) ? window.SPV_DEFAULT_MODELS : [];
      const base = defaults.find(x => x.electric_number === this.state.activeElectricNumber) || defaults[0];
      if (!base) return;
      this.state.draftTopFields = {
        target_daily_yield: Number(base.target_daily_yield),
        fit_rate: Number(base.fit_rate),
        ppa_share: Number(base.ppa_share || 0),
        ppa_rate: Number(base.ppa_rate || 0),
        annual_degradation_rate: Number(base.annual_degradation_rate ?? 0.004)
      };
      this.state.draftAssumptions = mergeAssumptions(base);
      this.render();
      if (typeof showToast === 'function') showToast('已還原財模試算預設參數（尚未寫入 Supabase，可按儲存套用）。');
    },

    openMonthEditModal(ym) {
      const model = this.getActiveModel();
      if (!model) return;
      const bills = typeof currentBills !== 'undefined' ? currentBills : [];
      const data = reconcileSpvMonthlyTracking(model, this.state.monthly, bills);
      const row = data.rows.find(r => r.tracking_year_month === ym);
      if (!row) return;
      this.state.editingMonthKey = ym;
      const modal = document.getElementById('spvMonthEditModal');
      if (!modal) return;
      document.getElementById('spvEditYmLabel').textContent = `${row.tracking_year_month} (${row.period_start} ~ ${row.period_end})`;
      document.getElementById('spvEditReportKwh').value = row.report_actual_kwh ?? '';
      document.getElementById('spvEditBilledKwh').value = row.taipower_billed_kwh ?? '';
      document.getElementById('spvEditPurchaseAmt').value = row.bill_purchase_amount ?? '';
      document.getElementById('spvEditSettlementAmt').value = row.bill_settlement_amount ?? '';
      document.getElementById('spvEditNetAmt').value = row.bill_net_payable_amount ?? '';
      document.getElementById('spvEditOpexOverride').value = row.opex_actual_override ?? '';
      document.getElementById('spvEditRemark').value = row.remark ?? '';
      modal.classList.remove('hidden');
    },

    closeMonthEditModal() {
      const modal = document.getElementById('spvMonthEditModal');
      if (modal) modal.classList.add('hidden');
      this.state.editingMonthKey = null;
    },

    async submitMonthEdit(e) {
      if (e) e.preventDefault();
      const ym = this.state.editingMonthKey;
      const model = this.getActiveModel();
      if (!ym || !model) return;
      const existing = this.state.monthly.find(r => r.tracking_year_month === ym && (!r.electric_number || r.electric_number === model.electric_number));
      if (!existing) return;

      const parseNum = (id) => {
        const v = document.getElementById(id).value.trim();
        return v === '' ? null : Number(v);
      };
      const updatedRow = {
        ...existing,
        plant_model_id: model.id,
        electric_number: model.electric_number,
        report_actual_kwh: parseNum('spvEditReportKwh'),
        taipower_billed_kwh: parseNum('spvEditBilledKwh'),
        bill_purchase_amount: parseNum('spvEditPurchaseAmt'),
        bill_settlement_amount: parseNum('spvEditSettlementAmt'),
        bill_net_payable_amount: parseNum('spvEditNetAmt'),
        opex_actual_override: parseNum('spvEditOpexOverride'),
        remark: document.getElementById('spvEditRemark').value.trim(),
        source: 'MANUAL_UPDATE'
      };

      const btn = document.getElementById('spvEditSubmitBtn');
      if (btn) { btn.disabled = true; btn.textContent = '同步中...'; }
      try {
        if (typeof SupabaseBillService !== 'undefined' && SupabaseBillService.upsertSpvMonthlyRow) {
          const res = await SupabaseBillService.upsertSpvMonthlyRow(updatedRow);
          const idx = this.state.monthly.findIndex(r => r.tracking_year_month === ym && (!r.electric_number || r.electric_number === model.electric_number));
          if (idx >= 0) {
            this.state.monthly[idx] = res.data || updatedRow;
          }
          this.closeMonthEditModal();
          this.render();
          if (typeof showToast === 'function') {
            showToast(res.synced ? `${ym} 月度實績已更新並同步至 Supabase！` : `${ym} 月度實績已暫存於本機。`);
          }
        }
      } catch (err) {
        if (typeof showToast === 'function') showToast('更新失敗：' + err.message, true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '儲存本月實績'; }
      }
    },

    exportExcel() {
      const model = this.getActiveModel();
      if (!model || typeof XLSX === 'undefined') {
        if (typeof showToast === 'function') showToast('Excel 匯出工具尚未載入', true);
        return;
      }
      const bills = typeof currentBills !== 'undefined' ? currentBills : [];
      const data = reconcileSpvMonthlyTracking(model, this.state.monthly, bills);
      const { financial_model: fin, rows, linked_bills: linkedBills } = data;

      const sheet1Rows = rows.map(r => ({
        '追蹤年月': r.tracking_year_month,
        '起日': r.period_start,
        '迄日': r.period_end,
        '日數': r.days,
        '高雄每月占比(%)': Number((r.monthly_share_pct * 100).toFixed(4)),
        '預測發電(kWh)': r.predicted_kwh,
        '月報實發(kWh)': r.report_actual_kwh ?? '',
        '達成率(%)': r.achievement_rate != null ? Number((r.achievement_rate * 100).toFixed(2)) : '',
        '實測DMY(kWh/kWp/日)': r.actual_dmy != null ? Number(r.actual_dmy.toFixed(2)) : '',
        '台電帳單度數(kWh)': r.taipower_billed_kwh ?? '',
        '帳單vs月報差異(kWh)': r.bill_report_diff_kwh ?? '',
        '對應台電期別': r.taipower_bill_months || '',
        '購電電費(未稅)': r.bill_purchase_amount ?? '',
        '試運轉結算差額(未稅)': r.bill_settlement_amount ?? '',
        '合計未稅營收(元)': r.total_billed_untaxed ?? '',
        '應付含稅淨額(元)': r.bill_net_payable_amount ?? '',
        '預估月OPEX(未稅)': Math.round(r.est_opex),
        '預估月EBITDA(未稅)': Math.round(r.est_ebitda),
        '備註': r.remark || ''
      }));

      const a = fin.assumptions;
      const sheet2Rows = [
        { '項目': 'SPV 公司名稱', '數值': model.spv_name, '說明': `統編 ${model.spv_tax_id}` },
        { '項目': '案場名稱 / 電號', '數值': `${model.site_name} (${model.electric_number})`, '說明': model.plant_location },
        { '項目': '併網容量 (kWp)', '數值': Number(model.capacity_kwp), '說明': `COD: ${model.cod_date}` },
        { '項目': '目標日發電 (DY)', '數值': Number(model.target_daily_yield), '說明': 'kWh/kWp/日' },
        { '項目': '正式躉購費率 (FIT)', '數值': Number(model.fit_rate), '說明': `試運轉暫結 ${model.provisional_trial_rate} 元` },
        { '項目': 'EPC 單位造價 (未稅)', '數值': a.unit_capex_untaxed, '說明': 'NT$/kWp' },
        { '項目': '初始投資總額 (未稅)', '數值': Math.round(fin.capex_untaxed), '說明': `含進項稅共 ${fmtNum(Math.round(fin.capex_total_cash))} 元` },
        { '項目': '銀行融資金額 (75%)', '數值': Math.round(fin.loan_amount), '說明': `年利率 ${(a.loan_interest_rate * 100).toFixed(2)}% / ${a.loan_years}年` },
        { '項目': '股東自備款 (Year 0)', '數值': Math.round(fin.equity_y0), '說明': '含進項營業稅墊付，第1年回收' },
        { '項目': '專案 IRR (無融資 20Y)', '數值': fin.project_irr != null ? Number((fin.project_irr * 100).toFixed(2)) : '', '說明': '%' },
        { '項目': '股東 IRR (融資後 20Y)', '數值': fin.equity_irr != null ? Number((fin.equity_irr * 100).toFixed(2)) : '', '說明': '%' },
        { '項目': '最低 DSCR (償債保障比)', '數值': fin.min_dscr != null ? Number(fin.min_dscr.toFixed(2)) : '', '說明': `目標 >= ${a.dscr_target}x` }
      ];

      const sheet3Rows = fin.years.map(y => ({
        '營運年度': y.year,
        '發電度數(kWh)': Math.round(y.generation_kwh),
        '售電收入(未稅)': Math.round(y.revenue_untaxed),
        '維運費': Math.round(y.om_cost),
        '土地屋頂租金': Math.round(y.rent_cost),
        '保險費': Math.round(y.insurance_cost),
        'SPV服務與管理費': Math.round(y.spv_cost),
        '模組回收費': Math.round(y.recycle_cost),
        'EBITDA(未稅)': Math.round(y.ebitda),
        '還本金額': Math.round(y.principal),
        '利息支出': Math.round(y.interest),
        'DSCR': y.dscr != null ? Number(y.dscr.toFixed(2)) : '',
        '所得稅': Math.round(y.income_tax),
        '專案現金流(Unlevered)': Math.round(y.unlevered_cf),
        '股東現金流(Levered)': Math.round(y.levered_cf),
        '累計股東現金流': Math.round(y.cum_levered_cf),
        '期末貸款餘額': Math.round(y.ending_loan)
      }));

      const sheet4Rows = linkedBills.map(b => ({
        '台電通知期別': b.bill_year_month || '',
        '計費期間': b.billing_period || '',
        '購電度數(kWh)': Number(b.total_kwh || 0),
        '單價(元/度)': Number(b.fit_rate || 0),
        '購電含結算未稅(元)': Number(b.purchase_amount || 0),
        '營業稅(元)': Number(b.tax_amount || 0),
        '電費合計(元)': Number(b.total_bill_amount || 0),
        '電表租費扣項(元)': Number(b.meter_rental_amount || 0),
        '應付淨額含稅(元)': Number(b.net_payable_amount || 0),
        '狀態': b.status || '',
        '原始檔名': b.filename || ''
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1Rows), '月度發電與財模追蹤');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2Rows), 'SPV財模假設與IRR');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet3Rows), '20年現金流與償債試算');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet4Rows), '台電電費單明細');

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `建坤SPV_${model.plant_code}_電廠財務追蹤_${today}.xlsx`);
      if (typeof showToast === 'function') showToast('已匯出完整建坤 SPV 電廠財務追蹤 Excel 報表！');
    },

    render() {
      const container = document.getElementById('spvFinanceRoot');
      if (!container) return;
      const model = this.getActiveModel();
      if (!model) {
        container.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-sm">正在載入建坤 SPV 財務追蹤資料...</div>';
        return;
      }

      const bills = typeof currentBills !== 'undefined' ? currentBills : [];
      const data = reconcileSpvMonthlyTracking(model, this.state.monthly, bills);
      const { financial_model: fin, rows, linked_bills: linkedBills, summary: s } = data;
      const a = fin.assumptions;

      const syncBadge = this.state.source === 'cloud'
        ? '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>Supabase 雲端即時同步</span>'
        : '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>已載入稽核基準庫（登入後可雙向寫入雲端）</span>';

      const plantOptions = this.state.models.map(m =>
        `<option value="${escHtml(m.electric_number)}" ${m.electric_number === model.electric_number ? 'selected' : ''}>${escHtml(m.site_name)} · ${fmtNum(m.capacity_kwp, 2)} kWp (${escHtml(m.electric_number)})</option>`
      ).join('');

      const achColor = s.overall_achievement >= 1 ? 'text-emerald-700' : 'text-amber-700';
      const dscrOk = fin.min_dscr !== null && fin.min_dscr >= a.dscr_target;
      const dscrBadge = dscrOk
        ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">合規 ≥ ${a.dscr_target.toFixed(1)}x</span>`
        : `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700">注意 &lt; ${a.dscr_target.toFixed(1)}x</span>`;

      const tableRowsHtml = rows.map(r => {
        const achText = r.achievement_rate != null ? fmtPct(r.achievement_rate, 2) : '<span class="text-slate-400">待實測</span>';
        const achBadgeCls = r.achievement_rate == null ? '' : (r.achievement_rate >= 1 ? 'text-emerald-700 font-bold bg-emerald-50' : 'text-amber-700 font-bold bg-amber-50');
        const diffHtml = r.bill_report_diff_kwh == null
          ? '<span class="text-slate-400">-</span>'
          : (r.bill_report_diff_kwh === 0
            ? '<span class="text-emerald-700 font-semibold">0</span>'
            : `<span class="text-indigo-700 font-semibold">${r.bill_report_diff_kwh > 0 ? '+' : ''}${fmtNum(r.bill_report_diff_kwh)}</span>`);
        const revUntaxedHtml = r.total_billed_untaxed != null
          ? `<div class="font-bold text-slate-900">${fmtNum(r.total_billed_untaxed)}</div>${r.bill_settlement_amount ? `<div class="text-[10px] text-indigo-700 font-semibold">含試運轉結算 +${fmtNum(r.bill_settlement_amount)}</div>` : ''}`
          : `<span class="text-slate-400">預估 ${fmtNum(Math.round(r.forecast_revenue_untaxed))}</span>`;
        const rowBg = r.effective_actual_kwh != null ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/50 text-slate-600';

        return `
          <tr class="${rowBg} border-b border-slate-200 text-xs transition">
            <td class="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap sticky left-0 bg-inherit z-10">${escHtml(r.tracking_year_month)}</td>
            <td class="py-2.5 px-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">${escHtml(r.period_start.slice(5))} ~ ${escHtml(r.period_end.slice(5))}</td>
            <td class="py-2.5 px-2 text-center font-mono">${r.days}</td>
            <td class="py-2.5 px-2 text-right font-mono">${(Number(r.monthly_share_pct) * 100).toFixed(2)}%</td>
            <td class="py-2.5 px-2.5 text-right font-mono text-slate-700">${fmtNum(r.predicted_kwh)}</td>
            <td class="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900">${r.report_actual_kwh != null ? fmtNum(r.report_actual_kwh) : '<span class="text-slate-400 font-normal">-</span>'}</td>
            <td class="py-2.5 px-2.5 text-right font-mono ${achBadgeCls}">${achText}</td>
            <td class="py-2.5 px-2 text-right font-mono">${r.actual_dmy != null ? r.actual_dmy.toFixed(2) : '-'}</td>
            <td class="py-2.5 px-2.5 text-right font-mono text-slate-800">${r.taipower_billed_kwh != null ? fmtNum(r.taipower_billed_kwh) : '<span class="text-slate-400">-</span>'}</td>
            <td class="py-2.5 px-2 text-right font-mono">${diffHtml}</td>
            <td class="py-2.5 px-2.5 text-[11px] text-slate-600 min-w-[150px]">${escHtml(r.taipower_bill_months || '-')}</td>
            <td class="py-2.5 px-2.5 text-right font-mono">${revUntaxedHtml}</td>
            <td class="py-2.5 px-2.5 text-right font-mono text-rose-700">-${fmtNum(Math.round(r.est_opex))}</td>
            <td class="py-2.5 px-2.5 text-right font-mono font-bold ${r.est_ebitda >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${fmtNum(Math.round(r.est_ebitda))}</td>
            <td class="py-2.5 px-2.5 text-[11px] text-slate-600 max-w-[240px]">${escHtml(r.remark || '')}</td>
            <td class="py-2.5 px-2 text-center">
              <button type="button" onclick="SpvFinance.openMonthEditModal('${escHtml(r.tracking_year_month)}')" class="px-2 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition">編輯</button>
            </td>
          </tr>`;
      }).join('');

      const billsHtml = linkedBills.map(b => {
        const hasSettlement = Array.isArray(b.machines_json) && b.machines_json.some(m => m.name && m.name.includes('結算'));
        return `
          <tr class="border-b border-slate-200 hover:bg-slate-50 text-xs">
            <td class="py-2 px-3 font-bold text-slate-900 whitespace-nowrap">${escHtml(b.bill_year_month || '-')}</td>
            <td class="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">${escHtml(b.billing_period || '-')}</td>
            <td class="py-2 px-3 text-right font-mono font-bold text-slate-900">${fmtNum(b.total_kwh)}</td>
            <td class="py-2 px-3 text-right font-mono">${b.fit_rate != null ? Number(b.fit_rate).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '-'}</td>
            <td class="py-2 px-3 text-right font-mono">${fmtNum(b.purchase_amount)}${hasSettlement ? ' <span class="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-800 rounded">含試運轉補結算 408,647</span>' : ''}</td>
            <td class="py-2 px-3 text-right font-mono text-slate-600">${fmtNum(b.tax_amount)}</td>
            <td class="py-2 px-3 text-right font-mono text-rose-700">${fmtNum(b.meter_rental_amount)}</td>
            <td class="py-2 px-3 text-right font-mono font-black text-emerald-700">${fmtNum(b.net_payable_amount)}</td>
            <td class="py-2 px-3 text-[11px] text-slate-500 max-w-[260px] truncate" title="${escHtml(b.filename)}">${escHtml(b.filename)}</td>
          </tr>`;
      }).join('');

      const yearsHtml = fin.years.map(y => `
        <tr class="border-b border-slate-200 hover:bg-slate-50 text-[11px] font-mono">
          <td class="py-1.5 px-2.5 text-center font-bold text-slate-800">Y${y.year}</td>
          <td class="py-1.5 px-2.5 text-right">${y.year === 0 ? '-' : fmtNum(Math.round(y.generation_kwh))}</td>
          <td class="py-1.5 px-2.5 text-right text-slate-900 font-semibold">${y.year === 0 ? '-' : fmtNum(Math.round(y.revenue_untaxed))}</td>
          <td class="py-1.5 px-2.5 text-right text-rose-700">${y.year === 0 ? '-' : `-${fmtNum(Math.round(y.total_opex))}`}</td>
          <td class="py-1.5 px-2.5 text-right font-bold text-emerald-700">${y.year === 0 ? '-' : fmtNum(Math.round(y.ebitda))}</td>
          <td class="py-1.5 px-2.5 text-right text-slate-600">${y.year === 0 ? '-' : fmtNum(Math.round(y.debt_service))}</td>
          <td class="py-1.5 px-2.5 text-center font-bold ${y.dscr == null ? 'text-slate-400' : (y.dscr >= a.dscr_target ? 'text-emerald-700' : 'text-rose-700')}">${y.dscr != null ? y.dscr.toFixed(2) + 'x' : '-'}</td>
          <td class="py-1.5 px-2.5 text-right ${y.unlevered_cf >= 0 ? 'text-slate-800' : 'text-rose-700'}">${fmtNum(Math.round(y.unlevered_cf))}</td>
          <td class="py-1.5 px-2.5 text-right font-bold ${y.levered_cf >= 0 ? 'text-indigo-700' : 'text-rose-700'}">${fmtNum(Math.round(y.levered_cf))}</td>
          <td class="py-1.5 px-2.5 text-right font-bold ${y.cum_levered_cf >= 0 ? 'text-emerald-700' : 'text-amber-700'}">${fmtNum(Math.round(y.cum_levered_cf))}</td>
          <td class="py-1.5 px-2.5 text-right text-slate-500">${fmtNum(Math.round(y.ending_loan))}</td>
        </tr>`).join('');

      container.innerHTML = `
        <!-- Header Banner -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-lg border border-indigo-900/50">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 tracking-wide">SPV ASSET & FINANCIAL TRACKER</span>
                ${syncBadge}
              </div>
              <h2 class="text-xl sm:text-2xl font-black tracking-tight">${escHtml(model.spv_name)} · 電廠財務模型追蹤工作表</h2>
              <p class="text-xs sm:text-sm text-slate-300">
                統一編號 <span class="font-mono font-bold text-white">${escHtml(model.spv_tax_id)}</span> ｜ 電號 <span class="font-mono font-bold text-amber-300">${escHtml(model.electric_number)}</span> ｜ 契約 <span class="font-mono">${escHtml(model.contract_number)}</span> ｜ COD <span class="font-mono font-bold text-emerald-300">${escHtml(model.cod_date)}</span>
              </p>
              <p class="text-[11px] text-slate-400">${escHtml(model.plant_location)}</p>
            </div>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <select id="spvPlantSelect" onchange="SpvFinance.selectPlant(this.value)" class="px-3 py-2 text-xs font-bold rounded-xl bg-slate-800/90 text-white border border-slate-600 focus:ring-2 focus:ring-indigo-400">
                ${plantOptions}
              </select>
              <button type="button" onclick="SpvFinance.exportExcel()" class="inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow transition">
                <span>匯出 SPV 財務追蹤 Excel</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Top 5 KPI Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div class="text-xs font-semibold text-slate-500 mb-1">併網容量 ＆ 日峰瓦對比</div>
            <div class="text-2xl font-black text-slate-900 font-mono">${fmtNum(model.capacity_kwp, 2)} <span class="text-xs font-bold text-slate-500">kWp</span></div>
            <p class="text-[11px] mt-1 font-semibold text-indigo-700">目標 DMY ${Number(model.target_daily_yield).toFixed(2)} ｜ 實測 ${s.actual_avg_dmy != null ? s.actual_avg_dmy.toFixed(2) : '-'} hr/日</p>
          </div>

          <div class="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm">
            <div class="text-xs font-semibold text-emerald-800 mb-1">累計實發 (${s.actual_months_count}個月實績) vs 預算</div>
            <div class="text-2xl font-black text-emerald-700 font-mono">${fmtNum(s.total_effective_actual_to_date)} <span class="text-xs font-bold">kWh</span></div>
            <p class="text-[11px] mt-1 font-bold ${achColor}">預算 ${fmtNum(s.total_predicted_to_date)} ｜ 達成率 ${fmtPct(s.overall_achievement)}</p>
          </div>

          <div class="bg-gradient-to-br from-indigo-50 to-blue-50 p-4 rounded-xl border border-indigo-200 shadow-sm">
            <div class="text-xs font-bold text-indigo-900 mb-1">台電已請款電費（含試運轉結算）</div>
            <div class="text-2xl font-black text-indigo-950 font-mono">${fmtCurrency(s.total_billed_untaxed)}</div>
            <p class="text-[11px] mt-1 font-semibold text-indigo-800">含稅實領 ${fmtCurrency(s.total_bill_net_payable)}（含差額 +408,647）</p>
          </div>

          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div class="text-xs font-semibold text-slate-500 mb-1">月報表 vs 台電帳單雙軌平帳</div>
            <div class="text-2xl font-black font-mono ${s.bill_vs_report_diff_kwh === 0 ? 'text-emerald-700' : 'text-amber-700'}">${s.bill_vs_report_diff_kwh === 0 ? '0 kWh' : fmtNum(s.bill_vs_report_diff_kwh) + ' kWh'}</div>
            <p class="text-[11px] mt-1 text-slate-600">台電 ${fmtNum(s.total_billed_kwh)} ＝ 月報 ${fmtNum(s.total_report_actual_to_date)}（7/8月±623平帳）</p>
          </div>

          <div class="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-xl border border-amber-200 shadow-sm">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-amber-900">20Y 財模 IRR ＆ 最低 DSCR</span>
              ${dscrBadge}
            </div>
            <div class="text-2xl font-black text-amber-950 font-mono">${fin.equity_irr != null ? fmtPct(fin.equity_irr, 2) : '-'} <span class="text-[11px] font-bold">股東IRR</span></div>
            <p class="text-[11px] mt-1 font-semibold text-amber-800">專案 ${fin.project_irr != null ? fmtPct(fin.project_irr, 2) : '-'} ｜ 最低 DSCR ${fin.min_dscr != null ? fin.min_dscr.toFixed(2) + 'x' : '-'}</p>
          </div>
        </div>

        <!-- Reconciliation & Forecast Callout Strip -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
            <div>
              <div class="text-[11px] font-bold text-slate-400 uppercase">首年追蹤區間年度預算 (2026/05–2027/04)</div>
              <div class="text-lg font-black text-slate-900 font-mono mt-0.5">${fmtNum(s.total_predicted_12m)} kWh</div>
              <div class="text-[11px] text-slate-500 mt-0.5">保守預估（實績＋剩餘月預算）：<strong class="text-slate-800 font-mono">${fmtNum(s.projected_12m_conservative_kwh)}</strong> 度</div>
            </div>
            <div class="text-right">
              <span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold font-mono">+${fmtNum(s.total_effective_actual_to_date - s.total_predicted_to_date)} 度</span>
              <div class="text-[10px] text-slate-500 mt-1">Run-rate: <span class="font-mono font-bold">${fmtNum(s.projected_12m_run_rate_kwh)}</span></div>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
            <div>
              <div class="text-[11px] font-bold text-slate-400 uppercase">核定躉購費率與權責收入檢核</div>
              <div class="text-lg font-black text-slate-900 font-mono mt-0.5">${Number(model.fit_rate).toFixed(3)} NT$/kWh</div>
              <div class="text-[11px] text-slate-500 mt-0.5">權責試算 (${fmtNum(s.total_effective_actual_to_date)} × ${model.fit_rate})：<strong class="text-slate-800 font-mono">${fmtCurrency(s.accrual_revenue_to_date)}</strong></div>
            </div>
            <div class="text-right text-[11px] text-slate-600">
              <div>試運轉暫結：<strong class="font-mono">${model.provisional_trial_rate}</strong></div>
              <div class="text-indigo-700 font-semibold">差額補領 +408,647</div>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
            <div>
              <div class="text-[11px] font-bold text-slate-400 uppercase">已實績月份 EBITDA 試算 (未稅)</div>
              <div class="text-lg font-black text-emerald-700 font-mono mt-0.5">${fmtCurrency(s.est_ebitda_to_date)}</div>
              <div class="text-[11px] text-slate-500 mt-0.5">實收未稅 ${fmtNum(s.total_billed_untaxed)} − 估計維運租金保險 ${fmtNum(Math.round(s.est_opex_to_date))}</div>
            </div>
            <div class="text-right text-[11px] text-slate-600">
              <div>電表租費：<strong class="font-mono text-rose-700">${fmtNum(s.total_bill_rental)}</strong></div>
              <div>營業稅：<strong class="font-mono">${fmtNum(s.total_bill_tax)}</strong></div>
            </div>
          </div>
        </div>

        <!-- SVG 12M Generation Chart -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h3 class="text-sm sm:text-base font-black text-slate-900">12 個月預測發電 vs 實際發電 ＆ 達成率曲線</h3>
              <p class="text-xs text-slate-500">依據高雄市每月日照比例反推月預算（灰柱），對照月報表／台電實測（綠柱達標／靛柱低於預算）與達成率折線（橘線）</p>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
              <span class="inline-flex items-center"><span class="w-3 h-3 rounded bg-slate-300 mr-1.5"></span>預算度數</span>
              <span class="inline-flex items-center"><span class="w-3 h-3 rounded bg-emerald-500 mr-1.5"></span>實發（達成≥100%）</span>
              <span class="inline-flex items-center"><span class="w-3 h-3 rounded bg-indigo-500 mr-1.5"></span>實發（&lt;100%）</span>
              <span class="inline-flex items-center"><span class="w-3 h-0.5 bg-amber-500 mr-1.5"></span>達成率%</span>
            </div>
          </div>
          ${buildGenerationSvgChart(rows)}
        </div>

        <!-- 12-Month Budget vs Actual & Monthly Cash Flow Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 class="text-sm sm:text-base font-black text-slate-900">建坤 SPV 月度發電預算 ＆ 電費現金流雙軌追蹤明細 (${escHtml(model.tracking_start_date)} ~ ${escHtml(model.tracking_end_date)})</h3>
              <p class="text-xs text-slate-500">整合「高振實業發電月報表 (~202609).xlsx」與「台電再生能源電費通知單」；點擊任一列「編輯」可直接更新月報實測並同步 Supabase</p>
            </div>
            <span class="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">未來新上傳 ${escHtml(model.electric_number)} 電費單將自動帶入對應月份</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-800 text-white text-[11px] font-bold whitespace-nowrap">
                  <th class="py-2.5 px-3 sticky left-0 bg-slate-800 z-10">追蹤年月</th>
                  <th class="py-2.5 px-2.5">計費起迄</th>
                  <th class="py-2.5 px-2 text-center">日數</th>
                  <th class="py-2.5 px-2 text-right">月占比</th>
                  <th class="py-2.5 px-2.5 text-right">預測發電(度)</th>
                  <th class="py-2.5 px-2.5 text-right">月報實發(度)</th>
                  <th class="py-2.5 px-2.5 text-right">達成率</th>
                  <th class="py-2.5 px-2 text-right">實測DMY</th>
                  <th class="py-2.5 px-2.5 text-right">台電帳單(度)</th>
                  <th class="py-2.5 px-2 text-right">帳單差</th>
                  <th class="py-2.5 px-2.5">台電通知單期別</th>
                  <th class="py-2.5 px-2.5 text-right">實收電費(未稅)</th>
                  <th class="py-2.5 px-2.5 text-right">預估OPEX</th>
                  <th class="py-2.5 px-2.5 text-right">預估EBITDA</th>
                  <th class="py-2.5 px-2.5">備註說明</th>
                  <th class="py-2.5 px-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody>${tableRowsHtml}</tbody>
              <tfoot class="bg-slate-100 border-t-2 border-slate-300 font-bold text-xs text-slate-900 font-mono">
                <tr>
                  <td class="py-2.5 px-3 sticky left-0 bg-slate-100 z-10">已實績小計 (${s.actual_months_count}M)</td>
                  <td class="py-2.5 px-2.5">5/11–9/30</td>
                  <td class="py-2.5 px-2 text-center">${s.total_actual_days}</td>
                  <td class="py-2.5 px-2 text-right">42.86%</td>
                  <td class="py-2.5 px-2.5 text-right">${fmtNum(s.total_predicted_to_date)}</td>
                  <td class="py-2.5 px-2.5 text-right text-emerald-700">${fmtNum(s.total_report_actual_to_date)}</td>
                  <td class="py-2.5 px-2.5 text-right ${achColor}">${fmtPct(s.overall_achievement)}</td>
                  <td class="py-2.5 px-2 text-right">${s.actual_avg_dmy != null ? s.actual_avg_dmy.toFixed(2) : '-'}</td>
                  <td class="py-2.5 px-2.5 text-right">${fmtNum(s.total_billed_kwh)}</td>
                  <td class="py-2.5 px-2 text-right text-emerald-700">${s.bill_vs_report_diff_kwh}</td>
                  <td class="py-2.5 px-2.5 font-sans text-[11px]">5 張台電電費單</td>
                  <td class="py-2.5 px-2.5 text-right text-indigo-800">${fmtNum(s.total_billed_untaxed)}</td>
                  <td class="py-2.5 px-2.5 text-right text-rose-700">-${fmtNum(Math.round(s.est_opex_to_date))}</td>
                  <td class="py-2.5 px-2.5 text-right text-emerald-700">${fmtNum(Math.round(s.est_ebitda_to_date))}</td>
                  <td class="py-2.5 px-2.5 font-sans text-[11px]" colspan="2">年度總預算 (12M): ${fmtNum(s.total_predicted_12m)} kWh</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- Linked Taipower Bills Panel -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 class="text-sm sm:text-base font-black text-slate-900">關聯台電再生能源電費通知單明細（電號 ${escHtml(model.electric_number)}，共 ${linkedBills.length} 張）</h3>
              <p class="text-xs text-slate-500">所有資料皆已核對原始 PDF 通知單與發電月報表，並同步存檔於 Supabase electricity_bills 資料表</p>
            </div>
            <div class="text-xs font-mono font-bold text-slate-700">
              累計實發 <span class="text-indigo-700">${fmtNum(s.bills_raw_kwh)} kWh</span> ｜ 含稅應付淨額 <span class="text-emerald-700">${fmtCurrency(s.bills_raw_net_payable)}</span>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-100 text-slate-700 border-b border-slate-300 text-[11px] font-bold whitespace-nowrap">
                  <th class="py-2 px-3">通知單期別</th>
                  <th class="py-2 px-3">計費期間</th>
                  <th class="py-2 px-3 text-right">購電度數</th>
                  <th class="py-2 px-3 text-right">單價(元/度)</th>
                  <th class="py-2 px-3 text-right">未稅購電電費</th>
                  <th class="py-2 px-3 text-right">營業稅</th>
                  <th class="py-2 px-3 text-right">電表租費</th>
                  <th class="py-2 px-3 text-right">應付淨額(含稅)</th>
                  <th class="py-2 px-3">原始PDF檔名</th>
                </tr>
              </thead>
              <tbody>${billsHtml || '<tr><td colspan="9" class="py-4 text-center text-xs text-slate-400">尚無關聯電費單</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <!-- Editable SPV Financial Model Parameters & 20-Year Cash Flow -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div class="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
            <div class="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 class="text-sm sm:text-base font-black text-slate-900">SPV 財模假設參數（台灣會計稅務範本 v1.2）</h3>
                <p class="text-[11px] text-slate-500">調整數值即時重算 IRR / NPV / DSCR 與各月預估損益</p>
              </div>
              <button type="button" onclick="SpvFinance.resetToDefaultParams()" class="px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">還原預設</button>
            </div>

            <div class="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">目標日均發電 DY (hr/日)</label>
                <input type="number" step="0.01" value="${model.target_daily_yield}" onchange="SpvFinance.onParamChange('target_daily_yield', this.value, true)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">正式躉購費率 FIT (元/度)</label>
                <input type="number" step="0.0001" value="${model.fit_rate}" onchange="SpvFinance.onParamChange('fit_rate', this.value, true)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">EPC 單位造價 (未稅元/kWp)</label>
                <input type="number" step="100" value="${a.unit_capex_untaxed}" onchange="SpvFinance.onParamChange('unit_capex_untaxed', this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">年發電衰減率 (%/年)</label>
                <input type="number" step="0.001" value="${model.annual_degradation_rate}" onchange="SpvFinance.onParamChange('annual_degradation_rate', this.value, true)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">維運計價模式</label>
                <select onchange="SpvFinance.onParamChange('om_mode', this.value)" class="w-full px-2 py-1.5 rounded-lg border border-slate-300">
                  <option value="fixed_per_kwp" ${a.om_mode === 'fixed_per_kwp' ? 'selected' : ''}>每 kWp 固定 (${a.om_unit_y1_15}元)</option>
                  <option value="pct_revenue" ${a.om_mode === 'pct_revenue' ? 'selected' : ''}>售電收入比例 (${(a.om_pct_revenue * 100).toFixed(1)}%)</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">${a.om_mode === 'fixed_per_kwp' ? '前15年維運單價(元/kWp)' : '維運佔營收比例(小數)'}</label>
                <input type="number" step="${a.om_mode === 'fixed_per_kwp' ? '10' : '0.005'}" value="${a.om_mode === 'fixed_per_kwp' ? a.om_unit_y1_15 : a.om_pct_revenue}" onchange="SpvFinance.onParamChange('${a.om_mode === 'fixed_per_kwp' ? 'om_unit_y1_15' : 'om_pct_revenue'}', this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">屋頂租金模式</label>
                <select onchange="SpvFinance.onParamChange('rent_mode', this.value)" class="w-full px-2 py-1.5 rounded-lg border border-slate-300">
                  <option value="pct_revenue" ${a.rent_mode === 'pct_revenue' ? 'selected' : ''}>營收分潤 (%)</option>
                  <option value="fixed_annual" ${a.rent_mode === 'fixed_annual' ? 'selected' : ''}>固定年租金 (未稅)</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">${a.rent_mode === 'pct_revenue' ? '租金佔營收比例(小數)' : '固定年租金(未稅元)'}</label>
                <input type="number" step="${a.rent_mode === 'pct_revenue' ? '0.01' : '10000'}" value="${a.rent_mode === 'pct_revenue' ? a.rent_pct_revenue : a.rent_fixed_annual}" onchange="SpvFinance.onParamChange('${a.rent_mode === 'pct_revenue' ? 'rent_pct_revenue' : 'rent_fixed_annual'}', this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">銀行融資成數 (小數)</label>
                <input type="number" step="0.05" value="${a.loan_ratio}" onchange="SpvFinance.onParamChange('loan_ratio', this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">貸款年利率 / 年期</label>
                <div class="flex space-x-1.5">
                  <input type="number" step="0.001" value="${a.loan_interest_rate}" onchange="SpvFinance.onParamChange('loan_interest_rate', this.value)" class="w-1/2 px-2 py-1.5 rounded-lg border border-slate-300 font-mono">
                  <input type="number" step="1" value="${a.loan_years}" onchange="SpvFinance.onParamChange('loan_years', this.value)" class="w-1/2 px-2 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
              </div>
            </div>

            <div class="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-[11px] bg-slate-50 rounded-xl p-3">
              <div>未稅建置 CAPEX：<strong class="font-mono text-slate-900">${fmtCurrency(fin.capex_untaxed)}</strong></div>
              <div>銀行貸款 (${(a.loan_ratio * 100).toFixed(0)}%)：<strong class="font-mono text-slate-900">${fmtCurrency(fin.loan_amount)}</strong></div>
              <div>股東自備款 (含進項稅)：<strong class="font-mono text-indigo-800">${fmtCurrency(fin.equity_y0)}</strong></div>
              <div>第 1 年全年度 EBITDA：<strong class="font-mono text-emerald-700">${fmtCurrency(fin.year1.ebitda)}</strong></div>
              <div>專案回收期：<strong class="font-mono">${fin.project_payback_years != null ? fin.project_payback_years.toFixed(2) + ' 年' : '-'}</strong></div>
              <div>股東回收期：<strong class="font-mono">${fin.equity_payback_years != null ? fin.equity_payback_years.toFixed(2) + ' 年' : '-'}</strong></div>
            </div>

            <button id="spvSaveParamsBtn" type="button" onclick="SpvFinance.saveParams()" class="w-full py-2.5 px-4 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow transition">儲存參數至 Supabase</button>
          </div>

          <div class="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div class="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <div>
                <h3 class="text-sm sm:text-base font-black text-slate-900">20 年營運現金流、EBITDA ＆ 償債覆蓋率 (DSCR) 試算表</h3>
                <p class="text-[11px] text-slate-500">依據參數即時試算 Year 0–Year ${a.project_years}（新台幣未稅，含營所稅 12 萬／20 萬門檻及前 10 年虧損扣抵）</p>
              </div>
              <div class="text-right text-xs font-mono">
                <div class="font-bold text-slate-900">NPV (${(a.discount_rate * 100).toFixed(0)}%): ${fmtCurrency(fin.project_npv)}</div>
              </div>
            </div>
            <div class="overflow-x-auto flex-1 max-h-[460px] overflow-y-auto">
              <table class="w-full text-left border-collapse">
                <thead class="sticky top-0 bg-slate-800 text-white text-[10.5px] font-bold whitespace-nowrap z-10">
                  <tr>
                    <th class="py-2 px-2.5 text-center">年度</th>
                    <th class="py-2 px-2.5 text-right">發電度數</th>
                    <th class="py-2 px-2.5 text-right">售電收入</th>
                    <th class="py-2 px-2.5 text-right">總OPEX</th>
                    <th class="py-2 px-2.5 text-right">EBITDA</th>
                    <th class="py-2 px-2.5 text-right">還本付息</th>
                    <th class="py-2 px-2.5 text-center">DSCR</th>
                    <th class="py-2 px-2.5 text-right">專案現金流</th>
                    <th class="py-2 px-2.5 text-right">股東現金流</th>
                    <th class="py-2 px-2.5 text-right">累計股東CF</th>
                    <th class="py-2 px-2.5 text-right">期末貸款</th>
                  </tr>
                </thead>
                <tbody>${yearsHtml}</tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Inline Edit Month Modal -->
        <div id="spvMonthEditModal" class="hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div class="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h4 class="text-sm font-black text-slate-900">編輯建坤 SPV 月度發電與電費實績</h4>
                <p id="spvEditYmLabel" class="text-xs font-mono text-indigo-700 mt-0.5">-</p>
              </div>
              <button type="button" onclick="SpvFinance.closeMonthEditModal()" class="text-slate-400 hover:text-slate-700 font-bold text-lg px-2">&times;</button>
            </div>
            <form onsubmit="SpvFinance.submitMonthEdit(event)" class="p-4 space-y-3 text-xs">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">月報表實發度數 (kWh)</label>
                  <input id="spvEditReportKwh" type="number" step="1" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">台電帳單度數 (kWh)</label>
                  <input id="spvEditBilledKwh" type="number" step="1" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">常態購電電費 (未稅元)</label>
                  <input id="spvEditPurchaseAmt" type="number" step="1" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">試運轉結算差額 (未稅元)</label>
                  <input id="spvEditSettlementAmt" type="number" step="1" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">應付含稅淨額 (元)</label>
                  <input id="spvEditNetAmt" type="number" step="1" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">實支 OPEX 覆寫 (選填未稅元)</label>
                  <input id="spvEditOpexOverride" type="number" step="1" placeholder="留白依財模比例自動估" class="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono">
                </div>
              </div>
              <div>
                <label class="block font-bold text-slate-700 mb-1">月報 / 財務核對備註</label>
                <input id="spvEditRemark" type="text" class="w-full px-3 py-1.5 rounded-lg border border-slate-300">
              </div>
              <div class="flex justify-end space-x-2 pt-2 border-t border-slate-200">
                <button type="button" onclick="SpvFinance.closeMonthEditModal()" class="px-4 py-2 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">取消</button>
                <button id="spvEditSubmitBtn" type="submit" class="px-4 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow">儲存本月實績</button>
              </div>
            </form>
          </div>
        </div>`;
    }
  };

  root.SpvFinance = Object.assign(SpvFinance, {
    calcTaiwanCorporateIncomeTax,
    computeIRR,
    computePaybackYears,
    mergeAssumptions,
    compute20YearFinancialModel,
    reconcileSpvMonthlyTracking,
    buildGenerationSvgChart
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SpvFinance;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
