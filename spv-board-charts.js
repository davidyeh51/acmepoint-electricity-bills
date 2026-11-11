(function (root) {
  'use strict';

  function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(v, decimals = 0) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    return Number(v).toLocaleString('zh-TW', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function fmtWan(v, decimals = 0) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    return `${fmtNum(Number(v) / 10000, decimals)}萬`;
  }

  function fmtPct(v, decimals = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    return `${(Number(v) * 100).toFixed(decimals)}%`;
  }

  function niceStep(range, targetTicks = 4) {
    if (!Number.isFinite(range) || range <= 0) return 100;
    const rough = range / Math.max(1, targetTicks);
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const mult = rough / pow10;
    let niceMult = 1;
    if (mult <= 1.2) niceMult = 1;
    else if (mult <= 2.2) niceMult = 2;
    else if (mult <= 2.8) niceMult = 2.5;
    else if (mult <= 5.5) niceMult = 5;
    else niceMult = 10;
    return niceMult * pow10;
  }

  function niceSignedBounds(valuesWan, targetTicks = 5) {
    const valid = valuesWan.filter((x) => Number.isFinite(x));
    const rawMin = Math.min(0, ...(valid.length ? valid : [0]));
    const rawMax = Math.max(0, ...(valid.length ? valid : [100]));
    const span = Math.max(10, rawMax - rawMin);
    const step = niceStep(span, targetTicks);
    const min = Math.floor(rawMin / step) * step;
    const max = Math.ceil(rawMax / step) * step;
    return { min, max: max === min ? min + step : max, step };
  }

  /**
   * 圖表一：20 年股東現金流量 ＆ 累計回收曲線 (Equity Payback J-Curve)
   */
  function buildEquityPaybackJCurveSvg(baselineFin, runRateFin, model) {
    const baseYears = (baselineFin && Array.isArray(baselineFin.years)) ? baselineFin.years : [];
    const runYears = (runRateFin && Array.isArray(runRateFin.years)) ? runRateFin.years : null;
    if (!baseYears.length) return '';

    const W = 680;
    const H = 330;
    const padL = 64;
    const padR = 64;
    const padT = 32;
    const padB = 46;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const annualWan = baseYears.map((y) => y.levered_cf / 10000);
    const cumBaseWan = baseYears.map((y) => y.cum_levered_cf / 10000);
    const cumRunWan = runYears ? runYears.map((y) => y.cum_levered_cf / 10000) : [];

    const barBounds = niceSignedBounds(annualWan, 4);
    const cumBounds = niceSignedBounds([...cumBaseWan, ...cumRunWan], 4);

    // Align 0 position between left (annual) and right (cumulative) axes if both cross zero
    const mapY = (val, bounds) => {
      const ratio = (val - bounds.min) / (bounds.max - bounds.min);
      return padT + plotH * (1 - ratio);
    };

    const yBarZero = mapY(0, barBounds);
    const yCumZero = mapY(0, cumBounds);

    let gridHtml = '';
    for (let v = cumBounds.min; v <= cumBounds.max + cumBounds.step * 0.001; v += cumBounds.step) {
      const y = mapY(v, cumBounds);
      const isZero = Math.abs(v) < 1e-6;
      gridHtml += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${isZero ? '#0f172a' : '#e2e8f0'}" stroke-width="${isZero ? '1.3' : '1'}" ${isZero ? '' : 'stroke-dasharray="3,3"'} />`;
      gridHtml += `<text x="${W - padR + 6}" y="${(y + 3.5).toFixed(1)}" font-size="9.5" font-weight="${isZero ? '700' : '500'}" fill="${isZero ? '#0f172a' : '#64748b'}">${fmtNum(Math.round(v))}萬</text>`;
    }

    for (let v = barBounds.min; v <= barBounds.max + barBounds.step * 0.001; v += barBounds.step) {
      const y = mapY(v, barBounds);
      gridHtml += `<text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${fmtNum(Math.round(v))}萬</text>`;
    }

    gridHtml += `<text x="${padL}" y="16" font-size="10" font-weight="700" fill="#475569">柱：年現金流 (萬)</text>`;
    gridHtml += `<text x="${W - padR}" y="16" text-anchor="end" font-size="10" font-weight="700" fill="#0f172a">線：累計淨回收 (萬)</text>`;

    const n = baseYears.length;
    const slotW = plotW / n;
    const barW = Math.min(18, slotW * 0.64);
    const loanYears = Number(baselineFin.assumptions?.loan_years || 15);

    let barsHtml = '';
    const basePts = [];
    const runPts = [];

    baseYears.forEach((yObj, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const valW = yObj.levered_cf / 10000;
      const yTop = mapY(Math.max(0, valW), barBounds);
      const yBot = mapY(Math.min(0, valW), barBounds);
      const bh = Math.max(1.5, yBot - yTop);

      let fill = '#3b82f6';
      if (yObj.year === 0) fill = '#e11d48';
      else if (yObj.year === 1) fill = '#6366f1';
      else if (yObj.year > loanYears) fill = '#10b981';

      barsHtml += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2.5" fill="${fill}" fill-opacity="0.82">` +
        `<title>Y${yObj.year} 股東現金流：${fmtWan(yObj.levered_cf, 1)}（累計：${fmtWan(yObj.cum_levered_cf, 1)}）</title></rect>`;

      basePts.push({ cx, cy: mapY(yObj.cum_levered_cf / 10000, cumBounds), year: yObj.year, val: yObj.cum_levered_cf });
      if (runYears && runYears[idx]) {
        runPts.push({ cx, cy: mapY(runYears[idx].cum_levered_cf / 10000, cumBounds), year: yObj.year, val: runYears[idx].cum_levered_cf });
      }

      if (yObj.year === 0 || yObj.year === 1 || yObj.year % 5 === 0) {
        barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">Y${yObj.year}</text>`;
      }
    });

    // Loan payoff milestone vertical guide (between loanYears and loanYears + 1)
    if (loanYears > 0 && loanYears < baseYears.length - 1) {
      const xDebtFree = padL + slotW * (loanYears + 1);
      gridHtml += `<line x1="${xDebtFree.toFixed(1)}" y1="${padT}" x2="${xDebtFree.toFixed(1)}" y2="${padT + plotH}" stroke="#10b981" stroke-width="1" stroke-dasharray="4,3" />`;
      gridHtml += `<text x="${(xDebtFree + 4).toFixed(1)}" y="${padT + 12}" font-size="9.5" font-weight="700" fill="#047857">Y${loanYears + 1} 貸款清償完畢</text>`;
    }

    let linesHtml = '';
    if (basePts.length > 1) {
      const dBase = basePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
      linesHtml += `<path d="${dBase}" fill="none" stroke="#0f172a" stroke-width="2.6" stroke-linejoin="round" />`;
      basePts.forEach((p) => {
        if (p.year === 0 || p.year === 1 || p.year === 10 || p.year === 15 || p.year === baseYears.length - 1) {
          linesHtml += `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="3.5" fill="#fff" stroke="#0f172a" stroke-width="2"><title>原案 Y${p.year} 累計股東現金流：${fmtWan(p.val, 1)}</title></circle>`;
        }
      });
    }

    if (runPts.length > 1) {
      const lastRun = runPts[runPts.length - 1].val;
      const lastBase = basePts[basePts.length - 1].val;
      const runColor = lastRun >= lastBase ? '#059669' : '#d97706';
      const dRun = runPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
      linesHtml += `<path d="${dRun}" fill="none" stroke="${runColor}" stroke-width="2.2" stroke-dasharray="5,4" stroke-linejoin="round" />`;
      const endP = runPts[runPts.length - 1];
      linesHtml += `<circle cx="${endP.cx.toFixed(1)}" cy="${endP.cy.toFixed(1)}" r="4" fill="${runColor}" stroke="#fff" stroke-width="1.5"><title>實績推估 20Y 累計：${fmtWan(endP.val, 1)}</title></circle>`;
    }

    // Payback star pin on Baseline cumulative zero crossing
    let annotationsHtml = '';
    const payback = baselineFin.equity_payback_years;
    if (payback !== null && Number.isFinite(payback) && payback >= 0 && payback <= baseYears.length - 1) {
      const px = padL + slotW * payback + slotW / 2;
      const clampedY = Math.max(padT + 14, Math.min(padT + plotH - 14, yCumZero));
      annotationsHtml += `<circle cx="${px.toFixed(1)}" cy="${clampedY.toFixed(1)}" r="5.5" fill="#f59e0b" stroke="#fff" stroke-width="2" />`;
      const boxX = Math.min(W - padR - 118, Math.max(padL + 6, px - 54));
      const boxY = Math.max(padT + 18, clampedY - 28);
      annotationsHtml += `<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="112" height="20" rx="5" fill="#fffbeb" stroke="#f59e0b" stroke-width="1" />`;
      annotationsHtml += `<text x="${(boxX + 56).toFixed(1)}" y="${(boxY + 13.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="#b45309">★ 原案回本 ${payback.toFixed(2)} 年</text>`;
    }

    const lastPt = basePts[basePts.length - 1];
    if (lastPt) {
      const moic = baselineFin.equity_moic != null ? `${baselineFin.equity_moic.toFixed(2)}x` : '-';
      const badgeY = Math.max(padT + 20, Math.min(padT + plotH - 22, lastPt.cy - 10));
      annotationsHtml += `<rect x="${(W - padR - 128).toFixed(1)}" y="${(badgeY - 12).toFixed(1)}" width="124" height="20" rx="5" fill="#0f172a" />`;
      annotationsHtml += `<text x="${(W - padR - 66).toFixed(1)}" y="${(badgeY + 1.5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#ffffff">20Y +${fmtWan(lastPt.val, 0)} (${moic})</text>`;
    }

    const label = escHtml((model && model.site_name) || '電廠');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="${label} 20年股東現金流與回本J曲線">${gridHtml}${barsHtml}${linesHtml}${annotationsHtml}</svg>`;
  }

  /**
   * 圖表二：20 年全生命週期現金流向瀑布圖 (Value Bridge Waterfall)
   */
  function buildCashWaterfallSvg(fin, model) {
    if (!fin || !Array.isArray(fin.years) || fin.years.length < 2) return '';

    const W = 680;
    const H = 330;
    const padL = 62;
    const padR = 26;
    const padT = 30;
    const padB = 56;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const revW = (fin.total_revenue_untaxed || 0) / 10000;
    const opexW = (fin.total_opex_20y || 0) / 10000;
    const ebitdaW = (fin.total_ebitda || 0) / 10000;
    const dsW = (fin.total_debt_service_20y || 0) / 10000;
    const taxW = (fin.total_tax_20y || 0) / 10000;
    const adjW = (fin.total_vat_recovery_decom_net || 0) / 10000;
    const eqRetW = (fin.total_equity_returned || 0) / 10000;
    const eqY0W = (fin.equity_y0 || 0) / 10000;

    const steps = [
      { label: '20Y總營收', sub: '售電未稅', start: 0, end: revW, delta: revW, color: '#4f46e5', isTotal: true },
      { label: '營運OPEX', sub: `${revW > 0 ? ((opexW / revW) * 100).toFixed(0) : 0}%`, start: revW, end: ebitdaW, delta: -opexW, color: '#f43f5e', isTotal: false },
      { label: 'EBITDA', sub: `${revW > 0 ? ((ebitdaW / revW) * 100).toFixed(0) : 0}%`, start: 0, end: ebitdaW, delta: ebitdaW, color: '#10b981', isTotal: true },
      { label: '銀行還本息', sub: '本金+利息', start: ebitdaW, end: ebitdaW - dsW, delta: -dsW, color: '#f59e0b', isTotal: false },
      { label: '營所稅', sub: '含虧損扣抵', start: ebitdaW - dsW, end: ebitdaW - dsW - taxW, delta: -taxW, color: '#ea580c', isTotal: false },
      { label: '退稅與除役', sub: 'Y1退稅-Y20拆', start: ebitdaW - dsW - taxW, end: eqRetW, delta: adjW, color: adjW >= 0 ? '#0284c7' : '#fb7185', isTotal: false },
      { label: '股東總回收', sub: `${fin.equity_moic != null ? fin.equity_moic.toFixed(2) + 'x' : ''}`, start: 0, end: eqRetW, delta: eqRetW, color: '#047857', isTotal: true }
    ];

    const bounds = niceSignedBounds([0, revW, ebitdaW, eqRetW, eqY0W], 4);
    const mapY = (val) => padT + plotH * (1 - (val - bounds.min) / (bounds.max - bounds.min));

    let gridHtml = '';
    for (let v = bounds.min; v <= bounds.max + bounds.step * 0.001; v += bounds.step) {
      const y = mapY(v);
      const isZero = Math.abs(v) < 1e-6;
      gridHtml += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${isZero ? '#0f172a' : '#e2e8f0'}" stroke-dasharray="${isZero ? '' : '3,3'}" />`;
      gridHtml += `<text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${fmtNum(Math.round(v))}萬</text>`;
    }

    // Equity Y0 Principal Reference Line
    if (eqY0W > 0) {
      const yEq = mapY(eqY0W);
      gridHtml += `<line x1="${padL}" y1="${yEq.toFixed(1)}" x2="${W - padR}" y2="${yEq.toFixed(1)}" stroke="#e11d48" stroke-width="1.4" stroke-dasharray="6,4" />`;
      gridHtml += `<rect x="${padL + 6}" y="${(yEq - 17).toFixed(1)}" width="150" height="15" rx="4" fill="#fff1f2" stroke="#fda4af" />`;
      gridHtml += `<text x="${padL + 81}" y="${(yEq - 6.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#be123c">股東自備款本金 ${fmtNum(Math.round(eqY0W))}萬</text>`;
    }

    const slotW = plotW / steps.length;
    const barW = Math.min(46, slotW * 0.56);
    let barsHtml = '';

    steps.forEach((st, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const y1 = mapY(Math.max(st.start, st.end));
      const y2 = mapY(Math.min(st.start, st.end));
      const h = Math.max(2.5, y2 - y1);

      if (idx > 0 && !st.isTotal) {
        const prevEnd = steps[idx - 1].end;
        const yConn = mapY(prevEnd);
        const prevCx = padL + slotW * (idx - 1) + slotW / 2;
        barsHtml += `<line x1="${(prevCx + barW / 2).toFixed(1)}" y1="${yConn.toFixed(1)}" x2="${(cx - barW / 2).toFixed(1)}" y2="${yConn.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2,2" />`;
      } else if (idx > 0 && st.isTotal) {
        const prevEnd = steps[idx - 1].end;
        const yConn = mapY(prevEnd);
        const prevCx = padL + slotW * (idx - 1) + slotW / 2;
        barsHtml += `<line x1="${(prevCx + barW / 2).toFixed(1)}" y1="${yConn.toFixed(1)}" x2="${(cx - barW / 2).toFixed(1)}" y2="${yConn.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2,2" />`;
      }

      const valLabel = st.isTotal
        ? `${fmtNum(Math.round(st.end))}萬`
        : `${st.delta >= 0 ? '+' : ''}${fmtNum(Math.round(st.delta))}萬`;

      barsHtml += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${st.color}" fill-opacity="0.9">` +
        `<title>${escHtml(st.label)}：${valLabel}（${escHtml(st.sub)}）</title></rect>`;
      barsHtml += `<text x="${cx.toFixed(1)}" y="${Math.max(14, y1 - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${st.color}">${valLabel}</text>`;
      barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#1e293b">${escHtml(st.label)}</text>`;
      barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="8.5" fill="#64748b">${escHtml(st.sub)}</text>`;
    });

    const netGainW = eqRetW - eqY0W;
    gridHtml += `<text x="${W - padR}" y="16" text-anchor="end" font-size="10" font-weight="700" fill="${netGainW >= 0 ? '#047857' : '#be123c'}">扣除自備款淨回收：${netGainW >= 0 ? '+' : ''}${fmtNum(Math.round(netGainW))}萬</text>`;

    const label = escHtml((model && model.site_name) || '電廠');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="${label} 20年全生命週期現金瀑布圖">${gridHtml}${barsHtml}</svg>`;
  }

  /**
   * 圖表三：年營運 EBITDA vs 銀行償債支出 ＆ DSCR 防線圖
   */
  function buildDscrDebtCoverageSvg(fin, model) {
    const opYears = (fin && Array.isArray(fin.years)) ? fin.years.slice(1) : [];
    if (!opYears.length) return '';

    const W = 680;
    const H = 310;
    const padL = 56;
    const padR = 52;
    const padT = 30;
    const padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const targetDscr = Number(fin.assumptions?.dscr_target || 1.2);
    const maxCashWan = Math.max(
      100,
      ...opYears.map((y) => Math.max(y.ebitda / 10000, y.debt_service / 10000))
    );
    const cashStep = niceStep(maxCashWan, 4);
    const cashTop = Math.ceil(maxCashWan / cashStep) * cashStep;

    const dscrVals = opYears.filter((y) => y.dscr != null).map((y) => y.dscr);
    const hasDebt = dscrVals.length > 0;
    const maxDscr = hasDebt ? Math.max(targetDscr * 1.4, ...dscrVals) * 1.08 : 2.0;

    const mapCashY = (wan) => padT + plotH * (1 - wan / cashTop);
    const mapDscrY = (ratio) => padT + plotH * (1 - Math.min(1, ratio / maxDscr));

    let gridHtml = '';
    for (let v = 0; v <= cashTop + cashStep * 0.001; v += cashStep) {
      const y = mapCashY(v);
      gridHtml += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${v === 0 ? '#0f172a' : '#e2e8f0'}" stroke-dasharray="${v === 0 ? '' : '3,3'}" />`;
      gridHtml += `<text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${fmtNum(Math.round(v))}萬</text>`;
    }

    if (hasDebt) {
      const yTarget = mapDscrY(targetDscr);
      gridHtml += `<line x1="${padL}" y1="${yTarget.toFixed(1)}" x2="${W - padR}" y2="${yTarget.toFixed(1)}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="5,4" />`;
      gridHtml += `<text x="${W - padR + 5}" y="${(yTarget + 3.5).toFixed(1)}" font-size="9.5" font-weight="800" fill="#dc2626">${targetDscr.toFixed(2)}x</text>`;
    }

    gridHtml += `<text x="${padL}" y="16" font-size="10" font-weight="700" fill="#4f46e5">柱：EBITDA vs 還本付息 (萬)</text>`;
    gridHtml += `<text x="${W - padR}" y="16" text-anchor="end" font-size="10" font-weight="700" fill="#be123c">${hasDebt ? `線：DSCR (最低 ${fin.min_dscr.toFixed(2)}x)` : '無融資案件'}</text>`;

    const slotW = plotW / opYears.length;
    const barW = Math.min(11, slotW * 0.36);
    let barsHtml = '';
    const dscrPts = [];

    opYears.forEach((yObj, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const ebWan = Math.max(0, yObj.ebitda / 10000);
      const dsWan = Math.max(0, yObj.debt_service / 10000);

      const yEb = mapCashY(ebWan);
      const hEb = Math.max(1.5, padT + plotH - yEb);
      barsHtml += `<rect x="${(cx - barW - 1).toFixed(1)}" y="${yEb.toFixed(1)}" width="${barW.toFixed(1)}" height="${hEb.toFixed(1)}" rx="2" fill="#6366f1">` +
        `<title>Y${yObj.year} EBITDA：${fmtWan(yObj.ebitda, 1)} ｜ 還本付息：${fmtWan(yObj.debt_service, 1)}${yObj.dscr != null ? ' ｜ DSCR：' + yObj.dscr.toFixed(2) + 'x' : ''}</title></rect>`;

      if (dsWan > 0) {
        const yDs = mapCashY(dsWan);
        const hDs = Math.max(1.5, padT + plotH - yDs);
        barsHtml += `<rect x="${(cx + 1).toFixed(1)}" y="${yDs.toFixed(1)}" width="${barW.toFixed(1)}" height="${hDs.toFixed(1)}" rx="2" fill="#f59e0b" fill-opacity="0.85">` +
          `<title>Y${yObj.year} 銀行本息：${fmtWan(yObj.debt_service, 1)}（本金 ${fmtWan(yObj.principal, 1)} ＋ 利息 ${fmtWan(yObj.interest, 1)}）</title></rect>`;
      }

      if (yObj.dscr != null) {
        dscrPts.push({ cx, cy: mapDscrY(yObj.dscr), y: yObj.year, dscr: yObj.dscr });
      }

      if (yObj.year === 1 || yObj.year % 5 === 0) {
        barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">Y${yObj.year}</text>`;
      }
    });

    let lineHtml = '';
    if (dscrPts.length > 0) {
      if (dscrPts.length > 1) {
        const dPath = dscrPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
        lineHtml += `<path d="${dPath}" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round" />`;
      }
      dscrPts.forEach((p) => {
        const isFail = p.dscr < targetDscr;
        const dotStroke = isFail ? '#dc2626' : '#059669';
        lineHtml += `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${isFail ? 4 : 3.2}" fill="${isFail ? '#fee2e2' : '#ecfdf5'}" stroke="${dotStroke}" stroke-width="2">` +
          `<title>Y${p.y} DSCR：${p.dscr.toFixed(2)}x ${isFail ? '（低於目標 ' + targetDscr.toFixed(2) + 'x）' : '（合規）'}</title></circle>`;
      });
    }

    const label = escHtml((model && model.site_name) || '電廠');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="${label} 年營運EBITDA與銀行DSCR防線圖">${gridHtml}${barsHtml}${lineHtml}</svg>`;
  }

  /**
   * 圖表四：原投資案 vs 實績推估 ＆ 情境 ROI 對照圖 (Board ROI Scenario Comparison)
   */
  function buildBoardScenarioComparisonSvg(scenarios, model) {
    const items = (scenarios && Array.isArray(scenarios.items)) ? scenarios.items : [];
    if (!items.length) return '';

    const W = 680;
    const rowH = 58;
    const padT = 36;
    const padB = 34;
    const H = padT + items.length * rowH + padB;
    const labelW = 195;
    const barLeft = labelW + 10;
    const metricsW = 215;
    const barMaxW = W - barLeft - metricsW;

    const baselineItem = items.find((it) => it.key === 'original_plan') || items[0];
    const targetEquityIrr = baselineItem?.fin?.equity_irr ?? 0.05;
    const discountRate = Number(baselineItem?.fin?.assumptions?.discount_rate ?? 0.06);

    const irrs = items.flatMap((it) => [it.fin?.equity_irr, it.fin?.project_irr]).filter((v) => v != null && Number.isFinite(v));
    const maxIrr = Math.max(0.10, targetEquityIrr * 1.35, discountRate * 1.25, ...irrs.map((v) => Math.max(0, v))) * 1.06;

    const mapX = (irr) => {
      const clamped = Math.max(0, Math.min(maxIrr, irr || 0));
      return barLeft + (clamped / maxIrr) * barMaxW;
    };

    let svg = '';
    svg += `<text x="10" y="18" font-size="10.5" font-weight="800" fill="#0f172a">評估情境</text>`;
    svg += `<text x="${barLeft}" y="18" font-size="10.5" font-weight="800" fill="#0f172a">股東 IRR (%) vs 原案目標 ＆ 資金門檻</text>`;
    svg += `<text x="${W - 8}" y="18" text-anchor="end" font-size="10" font-weight="800" fill="#475569">專案IRR ｜ 回本 ｜ DSCR</text>`;
    svg += `<line x1="8" y1="${padT - 8}" x2="${W - 8}" y2="${padT - 8}" stroke="#cbd5e1" stroke-width="1" />`;

    const yBottom = padT + items.length * rowH;

    // Vertical Reference Lines (Target Equity IRR & WACC/Discount Rate)
    if (targetEquityIrr > 0) {
      const xPlan = mapX(targetEquityIrr);
      svg += `<line x1="${xPlan.toFixed(1)}" y1="${padT - 4}" x2="${xPlan.toFixed(1)}" y2="${yBottom}" stroke="#4f46e5" stroke-width="1.4" stroke-dasharray="4,3" />`;
      svg += `<text x="${xPlan.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#4f46e5">原案 ${fmtPct(targetEquityIrr, 2)}</text>`;
    }
    if (discountRate > 0) {
      const xDisc = mapX(discountRate);
      svg += `<line x1="${xDisc.toFixed(1)}" y1="${padT - 4}" x2="${xDisc.toFixed(1)}" y2="${yBottom}" stroke="#d97706" stroke-width="1.2" stroke-dasharray="2,3" />`;
      svg += `<text x="${xDisc.toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="9" font-weight="700" fill="#b45309">資金門檻 ${fmtPct(discountRate, 1)}</text>`;
    }

    items.forEach((it, idx) => {
      const yTop = padT + idx * rowH;
      const midY = yTop + rowH / 2;
      const fin = it.fin;
      const eqIrr = fin?.equity_irr;
      const prIrr = fin?.project_irr;
      const pb = fin?.equity_payback_years;
      const dscr = fin?.min_dscr;
      const meetsTarget = eqIrr != null && targetEquityIrr != null && eqIrr >= targetEquityIrr - 0.0005;

      if (idx % 2 === 1) {
        svg += `<rect x="6" y="${yTop}" width="${W - 12}" height="${rowH - 4}" rx="8" fill="#f8fafc" />`;
      }

      svg += `<text x="14" y="${yTop + 21}" font-size="11" font-weight="800" fill="#0f172a">${escHtml(it.label)}</text>`;
      svg += `<text x="14" y="${yTop + 37}" font-size="9.2" fill="#64748b">${escHtml(it.sub)}</text>`;

      // Background track
      svg += `<rect x="${barLeft}" y="${midY - 9}" width="${barMaxW}" height="18" rx="4" fill="#e2e8f0" fill-opacity="0.55" />`;

      if (eqIrr != null && Number.isFinite(eqIrr)) {
        const xEnd = mapX(eqIrr);
        const wBar = Math.max(3, xEnd - barLeft);
        const fill = it.key === 'original_plan'
          ? '#4f46e5'
          : (meetsTarget ? '#10b981' : '#f59e0b');
        svg += `<rect x="${barLeft}" y="${midY - 9}" width="${wBar.toFixed(1)}" height="18" rx="4" fill="${fill}">` +
          `<title>${escHtml(it.label)}：股東 IRR ${fmtPct(eqIrr, 2)}，專案 IRR ${fmtPct(prIrr, 2)}，股東回收期 ${pb != null ? pb.toFixed(2) + '年' : '>20年'}</title></rect>`;

        const textInside = wBar > 52;
        svg += `<text x="${(textInside ? xEnd - 6 : xEnd + 5).toFixed(1)}" y="${midY + 3.5}" text-anchor="${textInside ? 'end' : 'start'}" font-size="10" font-weight="800" fill="${textInside ? '#ffffff' : '#0f172a'}">${fmtPct(eqIrr, 2)}</text>`;
      } else {
        svg += `<text x="${barLeft + 8}" y="${midY + 3.5}" font-size="9.5" font-weight="700" fill="#dc2626">未回本 / N/A</text>`;
      }

      const pbStr = pb != null ? `${pb.toFixed(1)}年` : '>20Y';
      const dscrStr = dscr != null ? `${dscr.toFixed(2)}x` : '-';
      svg += `<text x="${W - 8}" y="${midY + 3.5}" text-anchor="end" font-size="10" font-weight="700" fill="#334155">${fmtPct(prIrr, 2)} ｜ ${pbStr} ｜ ${dscrStr}</text>`;
    });

    const label = escHtml((model && model.site_name) || '電廠');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="${label} 投資情境ROI對照圖">${svg}</svg>`;
  }

  /**
   * 圖表五：首年 12 個月預測發電 vs 實際發電 ＆ 達成率曲線
   */
  function buildGenerationSvgChart(rows, model) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const W = 960;
    const H = 285;
    const padL = 62;
    const padR = 54;
    const padT = 26;
    const padB = 46;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxKwh = Math.max(
      10000,
      ...safeRows.map((r) => Math.max(Number(r.predicted_kwh || 0), Number(r.effective_actual_kwh || 0)))
    ) * 1.12;
    const maxPct = Math.max(
      1.35,
      ...safeRows.map((r) => (r.achievement_rate != null ? Number(r.achievement_rate) * 1.08 : 0))
    );

    const n = Math.max(1, safeRows.length);
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

    safeRows.forEach((r, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const predH = (Number(r.predicted_kwh || 0) / maxKwh) * plotH;
      const predY = padT + plotH - predH;

      barsHtml += `<rect x="${(cx - barW - 2).toFixed(1)}" y="${predY.toFixed(1)}" width="${barW.toFixed(1)}" height="${predH.toFixed(1)}" rx="3" fill="#cbd5e1">` +
        `<title>${escHtml(r.tracking_year_month)} 預測：${fmtNum(r.predicted_kwh)} 度</title></rect>`;

      if (r.effective_actual_kwh !== null && r.effective_actual_kwh !== undefined) {
        const actH = (Number(r.effective_actual_kwh) / maxKwh) * plotH;
        const actY = padT + plotH - actH;
        const beat = r.achievement_rate != null && r.achievement_rate >= 1;
        const fill = beat ? '#10b981' : '#6366f1';
        barsHtml += `<rect x="${(cx + 2).toFixed(1)}" y="${actY.toFixed(1)}" width="${barW.toFixed(1)}" height="${actH.toFixed(1)}" rx="3" fill="${fill}">` +
          `<title>${escHtml(r.tracking_year_month)} 實發：${fmtNum(r.effective_actual_kwh)} 度 (${fmtPct(r.achievement_rate)})</title></rect>`;

        if (r.achievement_rate !== null && r.achievement_rate !== undefined) {
          const py = padT + plotH * (1 - Math.min(1, r.achievement_rate / maxPct));
          linePts.push({ cx, py, r });
        }
      }

      barsHtml += `<text x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${escHtml(String(r.tracking_year_month || '').slice(2))}</text>`;
      if (r.achievement_rate !== null && r.achievement_rate !== undefined) {
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
      linePts.forEach((p) => {
        polyHtml += `<circle cx="${p.cx.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4" fill="#fff" stroke="#d97706" stroke-width="2.2">` +
          `<title>${escHtml(p.r.tracking_year_month)} 達成率：${fmtPct(p.r.achievement_rate)}</title></circle>`;
      });
    }

    const titlePrefix = escHtml((model && model.site_name) || 'SPV 電廠');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto select-none" role="img" aria-label="${titlePrefix} 12 個月發電預測與實績圖">${gridHtml}${barsHtml}${polyHtml}</svg>`;
  }

  /**
   * 董事會 ROI 檢核標準圖表範本區塊（可套用於任何電廠）
   */
  function buildBoardRoiSectionHtml({ model, baseFin, liveFin, scenarios, summary, printMode = false }) {
    const verdict = scenarios?.verdict || { tier: 'PRE_COD', badge: '財模基準檢核', headline: '', tone: 'slate', drivers: [] };
    const toneStyles = {
      emerald: { wrap: 'from-emerald-950 via-teal-950 to-slate-900 border-emerald-700/60', pill: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50' },
      amber: { wrap: 'from-slate-900 via-amber-950/90 to-slate-900 border-amber-600/60', pill: 'bg-amber-500/25 text-amber-200 border-amber-400/50' },
      rose: { wrap: 'from-slate-900 via-rose-950 to-slate-900 border-rose-700/60', pill: 'bg-rose-500/25 text-rose-200 border-rose-400/50' },
      slate: { wrap: 'from-slate-900 via-indigo-950 to-slate-900 border-indigo-700/60', pill: 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' }
    };
    const tone = toneStyles[verdict.tone] || toneStyles.slate;

    const runRateItem = (scenarios?.items || []).find((i) => i.key === 'actual_full_runrate')
      || (scenarios?.items || []).find((i) => i.key === 'actual_gen_plan_tariff');
    const runRateFin = runRateItem ? runRateItem.fin : null;

    const s = summary || {};
    const ytdGenBadge = s.overall_achievement != null
      ? `<span class="font-mono font-black ${s.overall_achievement >= 1 ? 'text-emerald-300' : 'text-amber-300'}">${fmtPct(s.overall_achievement, 1)}</span>`
      : '<span class="text-slate-300">待運轉實績</span>';
    const ytdRevBadge = s.revenue_vs_plan_pct != null
      ? `<span class="font-mono font-black ${s.revenue_vs_plan_pct >= 0.98 ? 'text-emerald-300' : 'text-amber-300'}">${fmtPct(s.revenue_vs_plan_pct, 1)}</span>`
      : '<span class="text-slate-300">-</span>';

    const driversHtml = (verdict.drivers || []).map((d) => `
      <div class="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5">
        <div class="text-[10.5px] font-bold text-slate-300">${escHtml(d.label)}</div>
        <div class="text-sm font-black mt-0.5 ${d.colorClass || 'text-white'}">${escHtml(d.value)}</div>
        <div class="text-[10.5px] text-slate-300/90 mt-0.5 leading-snug">${escHtml(d.detail)}</div>
      </div>`).join('');

    const planMoic = baseFin.equity_moic != null ? `${baseFin.equity_moic.toFixed(2)}x` : '-';
    const templateSource = model?.assumptions_json?.investment_model_source || '台灣會計與稅務標準電廠財模範本';

    const actionButtonsHtml = printMode ? '' : `
      <div class="flex flex-wrap items-center gap-2 no-print">
        <button type="button" onclick="SpvFinance.printBoardReport()" class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl shadow transition">
          <span>列印／另存董事會 ROI 簡報 (PDF)</span>
        </button>
      </div>`;

    return `
      <section class="space-y-4" id="spvBoardRoiSection">
        <!-- Executive Board ROI Verdict Banner -->
        <div class="bg-gradient-to-br ${tone.wrap} rounded-2xl border p-5 text-white shadow-lg">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div class="space-y-1.5 max-w-3xl">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black border ${tone.pill} tracking-wide">BOARD ROI TEMPLATE · 董事會投資檢核範本</span>
                <span class="text-[11px] text-slate-300 font-mono">基準財模：${escHtml(templateSource)}</span>
              </div>
              <h3 class="text-lg sm:text-xl font-black tracking-tight">${escHtml(model.site_name)} · 投資是否達預期 ROI 結論</h3>
              <p class="text-xs sm:text-sm text-slate-100 leading-relaxed">${escHtml(verdict.headline)}</p>
              <div class="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-200">
                <span>原案預期股東 IRR：<strong class="font-mono text-white">${fmtPct(baseFin.equity_irr, 2)}</strong>（回收 ${baseFin.equity_payback_years != null ? baseFin.equity_payback_years.toFixed(2) + ' 年' : '>20Y'} · ${planMoic}）</span>
                <span>實績發電達成率：${ytdGenBadge}</span>
                <span>實收電費達成原案：${ytdRevBadge}</span>
              </div>
            </div>
            ${actionButtonsHtml}
          </div>
          ${driversHtml ? `<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-3 border-t border-white/10">${driversHtml}</div>` : ''}
        </div>

        <!-- 4 Core Board Charts Grid (Reusable for Every Solar Plant) -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <!-- Chart 1: Equity Payback J-Curve -->
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h4 class="text-sm font-black text-slate-900">圖表一｜20 年股東現金流量 ＆ 回本曲線 (J-Curve)</h4>
                <p class="text-[11px] text-slate-500">投入自備款 ${fmtWan(baseFin.equity_y0, 0)}；原案 ${baseFin.equity_payback_years != null ? baseFin.equity_payback_years.toFixed(2) + ' 年回本' : '>20 年'}，Y${(baseFin.assumptions?.loan_years || 15) + 1} 貸款清償後現金流顯著跳增</p>
              </div>
              <div class="flex items-center gap-2.5 text-[10.5px] font-semibold text-slate-600">
                <span class="inline-flex items-center"><span class="w-3 h-0.5 bg-slate-900 mr-1"></span>原案累計</span>
                ${runRateFin ? '<span class="inline-flex items-center"><span class="w-3 h-0.5 border-t-2 border-dashed border-amber-600 mr-1"></span>實績推估</span>' : ''}
              </div>
            </div>
            ${buildEquityPaybackJCurveSvg(baseFin, runRateFin, model)}
          </div>

          <!-- Chart 2: 20Y Cash Flow Waterfall -->
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h4 class="text-sm font-black text-slate-900">圖表二｜20 年現金創造與分配瀑布圖 (原案 Value Bridge)</h4>
                <p class="text-[11px] text-slate-500">總建置 ${fmtWan(baseFin.capex_total_cash, 0)}（銀行 ${fmtPct(baseFin.assumptions?.loan_ratio, 0)} / 股東 ${fmtWan(baseFin.equity_y0, 0)}）➔ 20Y 股東回收 ${planMoic}</p>
              </div>
              <span class="px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10.5px] font-bold font-mono">EBITDA 率 ${baseFin.total_revenue_untaxed > 0 ? ((baseFin.total_ebitda / baseFin.total_revenue_untaxed) * 100).toFixed(1) + '%' : '-'}</span>
            </div>
            ${buildCashWaterfallSvg(baseFin, model)}
          </div>

          <!-- Chart 3: EBITDA vs Debt Service & DSCR Guardrail -->
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h4 class="text-sm font-black text-slate-900">圖表三｜年營運 EBITDA vs 銀行償債覆蓋率 (DSCR 防線)</h4>
                <p class="text-[11px] text-slate-500">檢視 ${baseFin.assumptions?.loan_years || 15} 年還貸期間各年度償債安全邊際；最低 DSCR ${baseFin.min_dscr != null ? baseFin.min_dscr.toFixed(2) + 'x' : '-'} vs 銀行目標 ${(baseFin.assumptions?.dscr_target || 1.2).toFixed(2)}x</p>
              </div>
              <span class="px-2 py-0.5 rounded-lg text-[10.5px] font-bold ${(baseFin.dscr_fail_years || []).length === 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${(baseFin.dscr_fail_years || []).length === 0 ? '全期合規' : `警示期別：${baseFin.dscr_fail_years.join(', ')}`}</span>
            </div>
            ${buildDscrDebtCoverageSvg(baseFin, model)}
          </div>

          <!-- Chart 4: Board Scenario Comparison -->
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h4 class="text-sm font-black text-slate-900">圖表四｜原投資案 vs 實績／關鍵情境 ROI 壓力測試</h4>
                <p class="text-[11px] text-slate-500">直接對比「當初投資預期」vs「目前發電與電價實績」對 20 年 IRR、回收期與 DSCR 之影響</p>
              </div>
              <span class="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10.5px] font-bold font-mono">LCOE ${baseFin.lcoe_untaxed != null ? baseFin.lcoe_untaxed.toFixed(2) : '-'} 元/度</span>
            </div>
            ${buildBoardScenarioComparisonSvg(scenarios, model)}
          </div>
        </div>
      </section>`;
  }

  /**
   * 產生可一鍵列印／轉存 PDF 的 A4 橫式董事會 ROI 簡報網頁
   */
  function buildPrintableBoardBriefHtml({ model, baseFin, liveFin, scenarios, rows, summary }) {
    const generatedAt = new Date().toLocaleString('zh-TW', { hour12: false });
    const verdict = scenarios?.verdict || {};
    const s = summary || {};
    const kpiRow = [
      { label: '裝置容量 / COD', val: `${fmtNum(model.capacity_kwp, 2)} kWp`, sub: `COD ${model.cod_date}` },
      { label: '原案總建置 (未稅)', val: fmtWan(baseFin.capex_untaxed, 0), sub: `單價 ${fmtNum(baseFin.assumptions?.unit_capex_untaxed)} 元/kWp` },
      { label: '股東自備款 (含稅)', val: fmtWan(baseFin.equity_y0, 0), sub: `貸款 ${fmtPct(baseFin.assumptions?.loan_ratio, 0)} (${fmtWan(baseFin.loan_amount, 0)})` },
      { label: '原案預期股東 IRR', val: fmtPct(baseFin.equity_irr, 2), sub: `專案 ${fmtPct(baseFin.project_irr, 2)} ｜ 回本 ${baseFin.equity_payback_years != null ? baseFin.equity_payback_years.toFixed(2) + 'Y' : '-'}` },
      { label: '實測發電達成率', val: fmtPct(s.overall_achievement, 1), sub: `實發 ${fmtNum(s.total_effective_actual_to_date)} / 預算 ${fmtNum(s.total_predicted_to_date)} 度` },
      { label: '已請款未稅電費', val: fmtWan(s.total_billed_untaxed, 1), sub: `實際均價 ${s.actual_effective_tariff != null ? s.actual_effective_tariff.toFixed(3) : '-'} 元/度` }
    ].map((k) => `
      <div style="border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;background:#f8fafc;">
        <div style="font-size:10px;color:#475569;font-weight:700;">${escHtml(k.label)}</div>
        <div style="font-size:18px;font-weight:900;color:#0f172a;margin:3px 0;font-family:ui-monospace,monospace;">${escHtml(k.val)}</div>
        <div style="font-size:10px;color:#64748b;">${escHtml(k.sub)}</div>
      </div>`).join('');

    const runRateItem = (scenarios?.items || []).find((i) => i.key === 'actual_full_runrate')
      || (scenarios?.items || []).find((i) => i.key === 'actual_gen_plan_tariff');
    const runRateFin = runRateItem ? runRateItem.fin : null;

    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(model.site_name)} - 董事會投資 ROI 檢核報告</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Noto Sans TC", "Microsoft JhengHei", -apple-system, sans-serif; color: #0f172a; background: #fff; }
    .page { page-break-after: always; padding: 6px 8px; }
    .page:last-child { page-break-after: auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
    .title { font-size: 19px; font-weight: 900; margin: 0; }
    .subtitle { font-size: 11px; color: #475569; margin-top: 2px; }
    .verdict { background: #f1f5f9; border-left: 5px solid #0f172a; padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; font-size: 12px; line-height: 1.5; }
    .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 10px; }
    .charts-2x2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px; background: #fff; break-inside: avoid; }
    .card h4 { margin: 0 0 4px 0; font-size: 12px; font-weight: 800; color: #0f172a; }
    .toolbar { position: fixed; top: 10px; right: 10px; z-index: 99; display: flex; gap: 8px; }
    .btn { background: #0f172a; color: #fff; border: 0; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
    @media print { .toolbar { display: none; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="window.print()">列印 / 另存 PDF</button>
  </div>
  <div class="page">
    <div class="header">
      <div>
        <h1 class="title">${escHtml(model.spv_name)} — ${escHtml(model.site_name)}｜董事會 ROI 檢核報告</h1>
        <div class="subtitle">電號：${escHtml(model.electric_number)} ｜ 契約：${escHtml(model.contract_number || '-')} ｜ 地點：${escHtml(model.plant_location || model.city || '-')}</div>
      </div>
      <div style="text-align:right;font-size:10px;color:#475569;">標準電廠財模範本<br/>產出時間：${escHtml(generatedAt)}</div>
    </div>
    <div class="verdict">
      <strong>董事會投資摘要：</strong>${escHtml(verdict.headline || '')}
    </div>
    <div class="kpis">${kpiRow}</div>
    <div class="charts-2x2">
      <div class="card"><h4>圖表一｜20 年股東現金流量 ＆ 回本曲線 (J-Curve)</h4>${buildEquityPaybackJCurveSvg(baseFin, runRateFin, model)}</div>
      <div class="card"><h4>圖表二｜20 年全生命週期現金流向瀑布圖</h4>${buildCashWaterfallSvg(baseFin, model)}</div>
      <div class="card"><h4>圖表三｜年營運 EBITDA vs 銀行償債覆蓋率 (DSCR)</h4>${buildDscrDebtCoverageSvg(baseFin, model)}</div>
      <div class="card"><h4>圖表四｜原投資案 vs 實績推估 ROI 情境對照</h4>${buildBoardScenarioComparisonSvg(scenarios, model)}</div>
    </div>
  </div>
  <div class="page">
    <div class="header">
      <div>
        <h1 class="title">${escHtml(model.site_name)}｜首年 12 個月發電預算 vs 實績追蹤</h1>
        <div class="subtitle">追蹤期間：${escHtml(model.tracking_start_date)} ~ ${escHtml(model.tracking_end_date)} ｜ 目標 DMY ${Number(model.target_daily_yield).toFixed(2)} vs 實測 ${s.actual_avg_dmy != null ? s.actual_avg_dmy.toFixed(2) : '-'} hr/日</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      ${buildGenerationSvgChart(rows, model)}
    </div>
    <div class="card">
      <h4>關鍵年度財務里程碑（原投資案基準）</h4>
      <p style="font-size:11px;color:#475569;margin:4px 0 8px 0;">20 年總發電量 ${fmtNum(Math.round(baseFin.total_generation_kwh))} kWh ｜ 總售電收入 ${fmtWan(baseFin.total_revenue_untaxed, 0)} ｜ 總 EBITDA ${fmtWan(baseFin.total_ebitda, 0)} ｜ 20Y 淨利 ${fmtWan(baseFin.total_net_income_20y, 0)} ｜ 股東淨回收 +${fmtWan(baseFin.total_levered_cf, 0)}</p>
    </div>
  </div>
</body>
</html>`;
  }

  root.SpvBoardCharts = {
    buildEquityPaybackJCurveSvg,
    buildCashWaterfallSvg,
    buildDscrDebtCoverageSvg,
    buildBoardScenarioComparisonSvg,
    buildGenerationSvgChart,
    buildBoardRoiSectionHtml,
    buildPrintableBoardBriefHtml
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SpvBoardCharts;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
