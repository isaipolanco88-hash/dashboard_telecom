/* ═══════════════════════════════════════════════
   CONFIG (localStorage)
═══════════════════════════════════════════════ */
const API_URL = 'https://script.google.com/macros/s/AKfycby52cJlCYBVCvN071IyG8puX8ilWDAmHxSlcRX4Lan4PwrjFlapjM-96JPH6t1wMmRs2A/exec';

/* ═══════════════════════════════════════════════
   SESSION & AUTHENTICATION
═══════════════════════════════════════════════ */
let AUTH_TOKEN = localStorage.getItem('t_token') || null;
let USER_ROLE = localStorage.getItem('t_role') || null;

function checkAuth() {
  if (!AUTH_TOKEN) {
    document.body.classList.add('is-logged-out');
    document.body.classList.remove('is-admin', 'is-viewer');
    document.getElementById('loginScreen').classList.add('open');
    document.getElementById('btnLogout').style.display = 'none';
    return false;
  }
  document.body.classList.remove('is-logged-out');
  document.body.classList.add(USER_ROLE === 'admin' ? 'is-admin' : 'is-viewer');
  document.getElementById('loginScreen').classList.remove('open');
  document.getElementById('btnLogout').style.display = 'inline-block';
  return true;
}

async function doLogin() {
  const pin = document.getElementById('loginPin').value.trim();
  const err = document.getElementById('loginError');
  if(!pin) return;
  
  err.innerText = "Autenticando...";
  try {
    const { json } = await fetchWithRetry(`${API_URL}?action=getConfig&t=${Date.now()}`);
    if (json.success) {
      const pAdmin = String(json.data.pin_admin || "0000").trim();
      const pGuest = String(json.data.pin_guest || "1111").trim();
      
      if (pin === pAdmin) {
        localStorage.setItem('t_token', pin);
        localStorage.setItem('t_role', 'admin');
      } else if (pin === pGuest) {
        localStorage.setItem('t_token', pin);
        localStorage.setItem('t_role', 'viewer');
      } else {
        err.innerText = "PIN incorrecto";
        return;
      }
      
      AUTH_TOKEN = pin;
      USER_ROLE = localStorage.getItem('t_role');
      err.innerText = "";
      document.getElementById('loginPin').value = "";
      if (checkAuth()) cargarDatos();
    } else {
      err.innerText = json.error || "Error de conexión";
    }
  } catch(e) {
    err.innerText = "Error de red";
  }
}

function logout() {
  localStorage.removeItem('t_token');
  localStorage.removeItem('t_role');
  AUTH_TOKEN = null;
  USER_ROLE = null;
  checkAuth();
}

let CFG = {
  name:     'Proyecto Telecom',
  start:    '',
  end:      '',
  target:   80,
  inact:    15,
  ...JSON.parse(localStorage.getItem('tcfg2') || '{}')
};

let barChart = null, tvChart = null;
let allSites = [];
let allExtraCols = [];
let activeFilter = 'all';
let sortCol = null;
let sortDir = 'desc';
function toggleSort(col) {
  if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortCol = col; sortDir = 'desc'; }
  applyFilters();
}
let tvInterval = null;

/* ═══════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
const today = () => new Date().toISOString().split('T')[0];

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.floor((db - da) / 86400000);
}

function activityDueBadge(fechaVenc) {
  if (!fechaVenc) return '';
  const days = daysBetween(today(), fechaVenc);
  if (days === null) return '';
  if (days < 0)  return `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#fee2e2;color:#991b1b;">🔴 Vencida (${Math.abs(days)}d)</span>`;
  if (days <= 2) return `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#fff7ed;color:#92400e;">🟠 Por vencer (${days}d)</span>`;
  return `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#f1f5f9;color:var(--muted);">📅 Vence: ${fechaVenc}</span>`;
}

function formatSpanishDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d)) return dateString;
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} del ${d.getFullYear()}`;
}

function expectedProgress() {
  if (!CFG.start || !CFG.end) return null;
  const total   = daysBetween(CFG.start, CFG.end);
  const elapsed = daysBetween(CFG.start, today());
  if (!total || total <= 0) return null;
  const r = Math.max(0, Math.min(1, elapsed / total));
  return +(r * CFG.target).toFixed(1);
}

function getSiteAging(s) {
  return daysBetween(s.fechaInicio || CFG.start || null, today());
}

function calcPriority(s) {
  const aging = getSiteAging(s);
  const p = s.progress || 0;
  if (s.blocked) return 'critical';
  if (aging !== null) {
    if (aging > 45 && p < 30) return 'critical';
    if (aging > 30 && p < 20) return 'critical';
    if (aging > 20 && p < 50) return 'risk';
    if (aging > 15 && p < 35) return 'risk';
  } else {
    if (p === 0) return 'risk';
  }
  return 'normal';
}

function calcHealth(data, sites) {
  const actual   = data.avgProgress || 0;
  const exp      = expectedProgress();
  const blocked  = data.blocked || 0;
  const criticals = sites.filter(s => s.priority === 'critical').length;

  if (criticals >= 3 || blocked >= 3) return 'red';
  if (exp !== null) {
    if (actual >= exp * 0.9 && blocked === 0) return 'green';
    if (actual >= exp * 0.75) return 'amber';
    return 'red';
  }
  if (actual >= 70 && blocked === 0) return 'green';
  if (actual >= 40 || blocked <= 1) return 'amber';
  return 'red';
}

/* ═══════════════════════════════════════════════
   RENDER: HEADER HEALTH PILL
═══════════════════════════════════════════════ */
function renderHealth(h) {
  const pill  = document.getElementById('hPill');
  const dot   = document.getElementById('hDot');
  const label = document.getElementById('hLabel');

  const map = {
    green: { pill:'hp-green', dot:'hd-green', text:'🟢 En Línea' },
    amber: { pill:'hp-amber', dot:'hd-amber', text:'🟡 En Riesgo' },
    red:   { pill:'hp-red',   dot:'hd-red',   text:'🔴 Crítico' },
  };
  const m = map[h];
  pill.className  = `health-pill ${m.pill}`;
  dot.className   = `health-dot ${m.dot}`;
  label.textContent = m.text;
}

/* ═══════════════════════════════════════════════
   RENDER: FORECAST STRIP
═══════════════════════════════════════════════ */
function renderForecast(data) {
  const actual = data.avgProgress || 0;
  const exp    = expectedProgress();
  const target = CFG.target;

  document.getElementById('fReal').textContent = actual.toFixed(1) + '%';

  if (CFG.end) {
    const dLeft = daysBetween(today(), CFG.end);
    document.getElementById('fPeriod').textContent =
      dLeft >= 0 ? `Quedan ${dLeft} días para el cierre` : `⚠️ Fecha de cierre superada`;
    document.getElementById('fTarget').textContent = target + '%';
  } else {
    document.getElementById('fPeriod').textContent = 'Configura ⚙️ para ver el período';
    document.getElementById('fTarget').textContent = '—';
  }

  // Bar: actual vs target
  const actualPct = Math.min(100, (actual / target) * 100);
  const fBar = document.getElementById('fBar');
  fBar.style.width = actualPct + '%';
  fBar.style.background = exp !== null && actual >= exp * 0.9 ? 'var(--green)' : 'var(--blue-lt)';

  // Expected line
  if (exp !== null) {
    const expPct = Math.min(100, (exp / target) * 100);
    const line  = document.getElementById('fExpLine');
    const lbl   = document.getElementById('fExpLabel');
    line.style.display = 'block';
    line.style.left    = expPct + '%';
    lbl.style.display  = 'block';
    lbl.style.left     = expPct + '%';
    lbl.textContent    = `Esp. ${exp}%`;
  }

  // Gap
  const gap = exp !== null ? actual - exp : null;
  const gEl = document.getElementById('fGap');
  if (gap === null) {
    gEl.textContent   = 'Configura ⚙️';
    gEl.className     = 'fs-gap gap-na';
  } else {
    gEl.textContent   = (gap >= 0 ? '+' : '') + gap.toFixed(1) + '%';
    gEl.className     = `fs-gap ${gap >= 0 ? 'gap-ok' : 'gap-bad'}`;
  }
}

/* ═══════════════════════════════════════════════
   RENDER: ALERTS
═══════════════════════════════════════════════ */
function renderAlerts(data, sites) {
  const bar    = document.getElementById('alertBar');
  const chips  = document.getElementById('alertChips');
  const alerts = [];
  const exp    = expectedProgress();

  sites.filter(s => s.blocked).forEach(s => {
    alerts.push({ level:'red', text:`🚫 ${s.site} bloqueado${s.motivo ? ': ' + s.motivo : ''}` });
  });

  sites.filter(s => s.priority === 'critical' && !s.blocked).forEach(s => {
    const ag = getSiteAging(s);
    alerts.push({ level:'red', text:`🔴 ${s.site} — ${ag !== null ? ag+'d' : 'N/D'} sin completar (${Math.round(s.progress)}%)` });
  });

  if (exp !== null && data.avgProgress < exp * 0.75) {
    alerts.push({ level:'red', text:`📉 Avance ${data.avgProgress.toFixed(1)}% vs esperado ${exp}%` });
  }

  const riskCount = sites.filter(s => s.priority === 'risk').length;
  if (riskCount > 0) {
    alerts.push({ level:'amber', text:`🟡 ${riskCount} site(s) en zona de riesgo` });
  }

  if (alerts.length === 0) { bar.classList.remove('visible'); return; }

  bar.classList.add('visible');
  const hasCrit = alerts.some(a => a.level === 'red');
  bar.style.background = hasCrit ? '#fff5f5' : '#fffbeb';
  bar.style.border     = hasCrit ? '1px solid #fecaca' : '1px solid #fde68a';

  chips.innerHTML = alerts.slice(0, 10).map(a =>
    `<div class="chip ${a.level === 'red' ? 'chip-red' : 'chip-amber'}">${a.text}</div>`
  ).join('');
}

/* ═══════════════════════════════════════════════
   RENDER: KPIs
═══════════════════════════════════════════════ */
function renderKPIs(data, sites, health) {
  const total     = data.totalSites || 0;
  const completed = data.completed  || 0;
  const pending   = data.pending    || 0;
  const blocked   = data.blocked    || 0;
  const avg       = data.avgProgress|| 0;
  const exp       = expectedProgress();
  const criticals = sites.filter(s => s.priority === 'critical').length;
  const risks     = sites.filter(s => s.priority === 'risk').length;

  const hColors = { green:'k-green', amber:'k-amber', red:'k-red' };
  const hLabels = { green:'🟢 En Línea', amber:'🟡 En Riesgo', red:'🔴 Crítico' };
  const hText   = { green:'t-green', amber:'t-amber', red:'t-red' };

  const delta   = exp !== null ? avg - exp : null;
  const deltaHtml = delta !== null
    ? `<span class="${delta >= 0 ? 't-green' : 't-red'}" style="font-weight:700;font-size:11px;">
         ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% vs esperado
       </span>`
    : `<span style="color:var(--muted);font-size:11px;">Configura ⚙️ para ver delta</span>`;

  const pendPct = total > 0 ? Math.round((pending/total)*100) : 0;
  const pendColor = pendPct > 70 ? 'k-red' : pendPct > 40 ? 'k-amber' : 'k-green';

  // Blocked reasons (if the API sends them)
  let blockedSub = blocked === 0
    ? '✅ Sin bloqueos activos'
    : `Ver detalle en tabla ↓`;
  if (data.blockedReasons && blocked > 0) {
    blockedSub = Object.entries(data.blockedReasons)
      .filter(([,v]) => v > 0)
      .map(([k,v]) => `<span class="mini-badge mb-red">${k} ${v}</span>`)
      .join(' ');
  }

  document.getElementById('kpiGrid').innerHTML = `
    <!-- 1. Salud -->
    <div class="kpi ${hColors[health]}">
      <div class="kpi-lbl">Salud General</div>
      <div class="kpi-health ${hText[health]}">${hLabels[health]}</div>
      <div class="kpi-sub">${criticals} crítico(s) · ${risks} en riesgo</div>
    </div>
    <!-- 2. Avance -->
    <div class="kpi ${delta !== null && delta >= 0 ? 'k-green' : delta !== null ? 'k-red' : 'k-blue'}">
      <div class="kpi-lbl">Avance Real</div>
      <div class="kpi-val">${avg.toFixed(1)}<sup>%</sup></div>
      <div class="kpi-sub">${deltaHtml}</div>
    </div>
    <!-- 3. Total -->
    <div class="kpi k-navy">
      <div class="kpi-lbl">Total Sites</div>
      <div class="kpi-val">${total}</div>
      <div class="kpi-sub">${completed} completados</div>
    </div>
    <!-- 4. Completadas -->
    <div class="kpi k-blue">
      <div class="kpi-lbl">Completadas</div>
      <div class="kpi-val">${completed}<span class="denom"> / ${total}</span></div>
      <div class="kpi-sub">${total > 0 ? Math.round((completed/total)*100) : 0}% del total</div>
    </div>
    <!-- 5. Críticos -->
    <div class="kpi ${criticals > 0 ? 'k-red' : 'k-green'}">
      <div class="kpi-lbl">Críticos</div>
      <div class="kpi-val">${criticals}</div>
      <div class="kpi-sub">${criticals > 0 ? 'Requieren atención inmediata' : '✅ Sin sites críticos'}</div>
    </div>
    <!-- 6. Bloqueadas -->
    <div class="kpi ${blocked > 0 ? 'k-red' : 'k-green'}">
      <div class="kpi-lbl">Bloqueadas</div>
      <div class="kpi-val">${blocked}</div>
      <div class="kpi-sub">${blockedSub}</div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════
   RENDER: BAR CHART
═══════════════════════════════════════════════ */
function renderChart(sites) {
  const ctx    = document.getElementById('barChart').getContext('2d');
  const colors = { critical:'#dc2626', risk:'#f59e0b', normal:'#10b981' };

  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sites.map(s => s.site),
      datasets: [{
        data: sites.map(s => Math.round(s.progress)),
        backgroundColor: sites.map(s => colors[s.priority]),
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const s   = sites[ctx.dataIndex];
              const ag  = getSiteAging(s);
              const out = [`Avance: ${ctx.raw}%`];
              if (ag !== null) out.push(`Aging: ${ag} días`);
              if (s.blocked)   out.push(`🚫 Bloqueado${s.motivo ? ': ' + s.motivo : ''}`);
              out.push(`Prioridad: ${s.priority === 'critical' ? '🔴 Crítico' : s.priority === 'risk' ? '🟡 Riesgo' : '🟢 Normal'}`);
              return out;
            }
          }
        }
      },
      scales: {
        y: { min:0, max:100, grid:{ color:'#f1f5f9' } },
        x: { grid:{ display:false } }
      }
    }
  });
}



/* ═══════════════════════════════════════════════
   RENDER: RISK PANEL
═══════════════════════════════════════════════ */
function renderRisks(data, sites) {
  const el     = document.getElementById('riskGrid');
  const risks  = [];
  const exp    = expectedProgress();
  const avg    = data.avgProgress || 0;

  // 1. Forecast gap
  if (exp !== null && avg < exp) {
    risks.push({ level:'critical', title:`Atraso: -${(exp - avg).toFixed(1)}%`,
      detail:`El avance está ${(exp - avg).toFixed(1)}% por debajo del ritmo necesario para cumplir la meta.` });
  }

  // 2. Blocked sites
  sites.filter(s => s.blocked).forEach(s => {
    risks.push({ level:'critical', title:`${s.site} bloqueado`,
      detail: s.motivo ? `Motivo: ${s.motivo}. Requiere acción inmediata.` : 'Sin motivo registrado. Revisar en campo.' });
  });

  // 3. High aging + low progress
  sites.filter(s => s.priority === 'critical' && !s.blocked).slice(0, 4).forEach(s => {
    const ag = getSiteAging(s);
    risks.push({ level:'critical', title:`${s.site} — ${ag !== null ? ag + ' días' : 'N/D'} abierto`,
      detail:`Solo ${Math.round(s.progress)}% de avance. Alto riesgo de incumplimiento.` });
  });

  // 4. At-risk sites
  sites.filter(s => s.priority === 'risk').slice(0, 3).forEach(s => {
    const ag = getSiteAging(s);
    risks.push({ level:'warning', title:`${s.site} en zona de riesgo`,
      detail:`${Math.round(s.progress)}% avance${ag !== null ? ' · ' + ag + ' días abierto' : ''}.` });
  });

  // 5. No config warning
  if (!CFG.end) {
    risks.push({ level:'warning', title:'Sin fecha límite configurada',
      detail:'Activa el forecast en ⚙️ Configurar para ver alertas automáticas de tiempo.' });
  }

  if (risks.length === 0) {
    el.innerHTML = '<p style="color:var(--green);font-weight:600;font-size:13px;">✅ Sin riesgos detectados. El proyecto avanza dentro de los parámetros normales.</p>';
    return;
  }

  el.innerHTML = risks.slice(0, 9).map(r => `
    <div class="risk-card ${r.level === 'critical' ? 'rc-red' : 'rc-amber'}">
      <div class="risk-icon">${r.level === 'critical' ? '🔴' : '🟡'}</div>
      <div class="risk-body"><strong>${r.title}</strong>${r.detail}</div>
    </div>`
  ).join('');
}

/* ═══════════════════════════════════════════════
   RENDER: SITE TABLE
═══════════════════════════════════════════════ */
function renderSiteTable(sites, filter, extraCols = []) {
  const el = document.getElementById('siteTable');
  let rows = [...sites];

  if (filter !== null) {
    if (filter === 'critical') rows = rows.filter(s => s.priority === 'critical');
    if (filter === 'risk')     rows = rows.filter(s => s.priority === 'risk');
    if (filter === 'blocked')  rows = rows.filter(s => s.blocked);
  }

  if (rows.length === 0) {
    el.innerHTML = '<div class="empty-state">Sin sites en esta categoría.</div>';
    return;
  }

  const order = { critical:0, risk:1, normal:2 };
  if (sortCol === 'aging') {
    rows.sort((a, b) => {
      const agA = getSiteAging(a) ?? -1;
      const agB = getSiteAging(b) ?? -1;
      return sortDir === 'desc' ? agB - agA : agA - agB;
    });
  } else {
    rows.sort((a,b) => order[a.priority] - order[b.priority]);
  }

  el.innerHTML = `<table>
    <thead>
      <tr>
        <th>Prioridad</th>
        <th>SITE</th>
        <th>Avance</th>
        <th style="cursor:pointer;user-select:none;" onclick="toggleSort('aging')">
          Aging ${sortCol === 'aging' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
        </th>
        <th>Estado</th>
        <th>Bloqueo</th>
        <th>Responsable</th>
        ${extraCols.map(c => `<th>${c}</th>`).join('')}
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(s => {
        const p   = Math.round(s.progress);
        const ag  = getSiteAging(s);

        const pbadge = s.priority === 'critical'
          ? '<span class="pbadge pb-red">🔴 Crítico</span>'
          : s.priority === 'risk'
          ? '<span class="pbadge pb-amber">🟡 Riesgo</span>'
          : '<span class="pbadge pb-green">🟢 Normal</span>';

        const pfClass = s.blocked ? 'pf-red' : p >= 75 ? 'pf-green' : p >= 40 ? 'pf-amber' : 'pf-gray';

        const agHtml = ag === null
          ? '<span style="color:var(--muted);font-size:12px;">N/D</span>'
          : (() => {
              const over = ag > CFG.inact;
              const cls = ag > 45 ? 'ag-crit' : ag > 20 ? 'ag-warn' : 'ag-ok';
              return `<span class="aging ${cls}">${ag}d</span>${over ? ' <span class="mini-badge mb-red">⏰</span>' : ''}`;
            })();

        let status = '';
        if (p === 100)    status = '<div class="sdot sd-green"></div>Completado';
        else if (s.blocked) status = '<div class="sdot sd-red"></div>Bloqueado';
        else if (p > 0)   status = '<div class="sdot sd-amber"></div>En Ejecución';
        else              status = '<div class="sdot sd-gray"></div>Pendiente';

        const MOTIVOS = ['Permiso','Energía','Acceso','Material','Clima','Otro'];
        const motivo = s.blocked
          ? `<select class="motivo-sel" onchange="actualizarSite('${s.site}','motivo',this.value)">
               <option value="">Sin motivo</option>
               ${MOTIVOS.map(m => `<option value="${m}"${s.motivo === m ? ' selected' : ''}>${m}</option>`).join('')}
             </select>`
          : '—';

        return `<tr>
          <td>${pbadge}</td>
          <td><strong>${s.site}</strong>${s.fechaInicio ? `<br><span style="font-size:10px;color:var(--muted);">Inicio: ${formatSpanishDate(s.fechaInicio)}</span>` : ''}</td>
          <td>
            <div class="prog-cell">
              <div class="prog-bg"><div class="prog-fg ${pfClass}" style="width:${p}%"></div></div>
              <span style="font-weight:700;min-width:34px;">${p}%</span>
            </div>
          </td>
          <td>${agHtml}</td>
          <td><div style="display:flex;align-items:center;">${status}</div></td>
          <td>${motivo}</td>
          <td style="font-size:12px;color:var(--text);">${s.responsable || '<span style="color:var(--muted);">—</span>'}</td>
          ${extraCols.map(c => `<td>${(s.extras && s.extras[c]) || '—'}</td>`).join('')}
          <td><button class="btn-sm" onclick="verDetalle('${s.site}')">Ver →</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

/* ═══════════════════════════════════════════════
   FILTER TABLE
═══════════════════════════════════════════════ */
function applyFilters() {
  const resp = document.getElementById('filterResp').value;
  let rows = [...allSites];
  if (activeFilter === 'critical')  rows = rows.filter(s => s.priority === 'critical');
  else if (activeFilter === 'risk') rows = rows.filter(s => s.priority === 'risk');
  else if (activeFilter === 'blocked')  rows = rows.filter(s => s.blocked);
  else if (activeFilter === 'inactive') rows = rows.filter(s => { const ag = getSiteAging(s); return ag !== null && ag > CFG.inact; });
  if (resp) rows = rows.filter(s => s.responsable === resp);
  renderSiteTable(rows, null, allExtraCols);
}

function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  applyFilters();
}

/* ═══════════════════════════════════════════════
   MAIN: LOAD DATA
═══════════════════════════════════════════════ */
async function cargarDatos() {
  if (!checkAuth()) return;
  document.getElementById('siteTable').innerHTML = '<div class="loading-cell"><div class="spinner"></div><p>Actualizando datos…</p></div>';
  try {
    const url  = `${API_URL}?action=getDashboard&t=${Date.now()}`;
    const { json } = await fetchWithRetry(url);

    if (!json.success) throw new Error(json.error || 'Error de API');

    const data = json.data;

    // Enrich sites
    const sites = (data.sitesProgress || []).map(s => ({
      ...s,
      blocked:    s.blocked || false,
      motivo:     s.motivo || null,
      fechaInicio:s.fechaInicio || null,
    }));
    sites.forEach(s => { s.priority = calcPriority(s); });
    allSites = sites;
    allExtraCols = data.extraColumns || [];

    const health = calcHealth(data, sites);

    renderHealth(health);
    renderForecast(data);
    renderAlerts(data, sites);
    renderKPIs(data, sites, health);
    renderChart(sites);
    renderRisks(data, sites);

    const respSelect = document.getElementById('filterResp');
    const resps = [...new Set(sites.map(s => s.responsable).filter(Boolean))].sort();
    const cur = respSelect.value;
    respSelect.innerHTML = '<option value="">👤 Todos</option>' +
      resps.map(r => `<option value="${r}"${r === cur ? ' selected' : ''}>${r}</option>`).join('');

    applyFilters();

    // TV KPIs (update if TV is open)
    updateTVKPIs(data, health);

    const now = new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('hMeta').textContent = `🕒 Actualizado ${now}`;
    document.getElementById('hBrandText').textContent = `📡 ${CFG.name}`;

  } catch (err) {
    console.error(err);
    document.getElementById('hMeta').textContent = '❌ Error al cargar';
    document.getElementById('siteTable').innerHTML =
      `<div class="empty-state" style="color:var(--red);">❌ ${err.message}<br><br>
       <small>Verifica que la URL del script esté correcta y desplegada como web app.</small></div>`;
  }
}

/* ═══════════════════════════════════════════════
   DETAIL MODAL
═══════════════════════════════════════════════ */
function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
}

async function verDetalle(site) {
  const siteData = allSites.find(s => s.site === site) || {};
  document.getElementById('dmResp').textContent = siteData.responsable || '—';
  const overlay = document.getElementById('detailOverlay');
  document.getElementById('dmTitle').textContent = `📋 ${site}`;
  document.getElementById('dmComp').textContent = '...';
  document.getElementById('dmPend').textContent = '...';
  document.getElementById('dmAvance').textContent = '...';
  document.getElementById('dmActivities').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted); font-size: 13px; font-weight: 600;">⏳ Cargando actividades desde el servidor...</div>';
  overlay.classList.add('open');

  try {
    const url  = `${API_URL}?action=getSiteDetail&site=${encodeURIComponent(site)}&t=${Date.now()}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data;
    
    document.getElementById('dmComp').textContent = `${d.summary.completed} / ${d.summary.total}`;
    document.getElementById('dmPend').textContent = d.summary.pending;
    document.getElementById('dmAvance').textContent = `${d.summary.avgProgress.toFixed(1)}%`;
    
    if (!d.activities || d.activities.length === 0) {
      document.getElementById('dmActivities').innerHTML = '<div class="empty-state">No hay actividades registradas.</div>';
      return;
    }

    document.getElementById('dmActivities').innerHTML = d.activities.map(a => {
      const color = a.avance === 100 ? '#065f46' : a.avance > 0 ? '#92400e' : 'var(--muted)';
      const bg = a.avance === 100 ? 'var(--green-bg)' : a.avance > 0 ? 'var(--amber-bg)' : '#e2e8f0';
      const border = a.avance === 100 ? 'rgba(16,185,129,.3)' : a.avance > 0 ? 'rgba(245,158,11,.3)' : 'var(--border)';
      
      const dueBadgeHtml = activityDueBadge(a.fechaVencimiento || '');

      const commentText = a.comentario || a.notas;
      const commentHtml = commentText 
        ? `<div style="font-size: 11px; margin-top: 8px; padding: 8px 12px; background: #f8fafc; border-left: 3px solid var(--blue-lt); border-radius: 4px; color: var(--text);">💬 <strong>Comentario:</strong> ${commentText}</div>` 
        : '';
        
      const photoHtml = a.foto 
        ? `<div style="margin-top: 8px;"><a href="${a.foto}" target="_blank" style="font-size: 11px; font-weight: 600; color: var(--blue); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;"><span style="font-size:14px">📷</span> Ver Foto (Drive)</a></div>`
        : `<div style="margin-top: 8px; font-size: 11px; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 4px;"><span style="font-size:14px; filter: grayscale(1); opacity: 0.5;">📷</span> Sin foto asignada</div>`;

      return `
        <div style="border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--white); box-shadow: 0 1px 3px rgba(0,0,0,.02);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
            <div style="font-weight: 600; font-size: 13px; color: var(--navy); line-height: 1.4;">${a.actividad}</div>
            <div style="background: ${bg}; color: ${color}; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; border: 1px solid ${border};">
              ${a.avance}% — ${a.estado}
            </div>
          </div>
          ${dueBadgeHtml}
          ${commentHtml}
          ${photoHtml}
        </div>
      `;
    }).join('');

  } catch(e) { 
    document.getElementById('dmActivities').innerHTML = `<div class="empty-state" style="color:var(--red);">❌ Error: ${e.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════
   ACTUALIZAR SITE
═══════════════════════════════════════════════ */
async function actualizarSite(siteName, field, value) {
  try {
    const params = new URLSearchParams({ action:'updateSite', site:siteName, [field]:value, token:(AUTH_TOKEN||'') }).toString();
    const res = await fetch(`${API_URL}?${params}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const s = allSites.find(x => x.site === siteName);
    if (s) s[field] = field === 'blocked' ? (value === 'true') : value;
    applyFilters();
  } catch(e) { alert('❌ Error al actualizar: ' + e.message); }
}

/* ═══════════════════════════════════════════════
   NUEVO SITE
═══════════════════════════════════════════════ */
function nuevoSite() {
  document.getElementById('nsNombre').value = '';
  document.getElementById('nsResp').value = '';
  document.getElementById('nuevoSiteOverlay').classList.add('open');
}
async function confirmarNuevoSite() {
  const name = document.getElementById('nsNombre').value.trim();
  const resp = document.getElementById('nsResp').value.trim();
  if (!name) { alert('El nombre del SITE es requerido.'); return; }
  document.getElementById('nuevoSiteOverlay').classList.remove('open');
  try {
    const url = `${API_URL}?action=createSite&siteName=${encodeURIComponent(name)}&responsable=${encodeURIComponent(resp)}&token=${encodeURIComponent(AUTH_TOKEN||'')}&t=${Date.now()}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    alert(`✅ ${json.data.message}`);
    cargarDatos();
  } catch(e) { alert('❌ Error: ' + e.message); }
}

/* ═══════════════════════════════════════════════
   CONFIG MODAL
═══════════════════════════════════════════════ */
async function fetchWithRetry(url, retries = 2, delay = 3000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return { res, json }; // Return both so callers don't break
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function openConfig() {
  document.getElementById('cfgOverlay').classList.add('open');
  try {
    const res = await fetch(`${API_URL}?action=getConfig&t=${Date.now()}`);
    const json = await res.json();
    if (json.success) {
      const c = json.data;
      document.getElementById('cName').value   = c.nombre      || CFG.name;
      document.getElementById('cStart').value  = c.inicio      || CFG.start;
      document.getElementById('cEnd').value    = c.cierre      || CFG.end;
      document.getElementById('cTarget').value = c.meta        ?? CFG.target;
      document.getElementById('cInact').value  = c.inactividad ?? CFG.inact;
    } else throw new Error(json.error);
  } catch(_) {
    // Fallback to localStorage
    document.getElementById('cName').value   = CFG.name;
    document.getElementById('cStart').value  = CFG.start;
    document.getElementById('cEnd').value    = CFG.end;
    document.getElementById('cTarget').value = CFG.target;
    document.getElementById('cInact').value  = CFG.inact;
  }
}
function closeConfig() {
  document.getElementById('cfgOverlay').classList.remove('open');
}
async function saveConfig() {
  const nombre = document.getElementById('cName').value   || 'Proyecto Telecom';
  const inicio = document.getElementById('cStart').value  || '';
  const cierre = document.getElementById('cEnd').value    || '';
  const meta   = parseFloat(document.getElementById('cTarget').value) || 80;
  const inact  = parseInt(document.getElementById('cInact').value)    || 15;
  CFG = { name: nombre, start: inicio, end: cierre, target: meta, inact };
  localStorage.setItem('tcfg2', JSON.stringify(CFG));
  closeConfig();
  cargarDatos();
  try {
    const p = new URLSearchParams({ action:'saveConfig', nombre, inicio, cierre,
      meta: String(meta), inactividad: String(inact), token:(AUTH_TOKEN||''), t: Date.now() }).toString();
    await fetch(`${API_URL}?${p}`);
  } catch(_) { /* localStorage cache still works */ }
}

/* ═══════════════════════════════════════════════
   TV MODE
═══════════════════════════════════════════════ */
let tvChartInst = null;

function updateTVKPIs(data, health) {
  const hMap = { green:'🟢 En Línea', amber:'🟡 En Riesgo', red:'🔴 Crítico' };
  document.getElementById('tvHealth').textContent    = hMap[health] || '—';
  document.getElementById('tvHealthSub').textContent = `${data.blocked || 0} bloqueadas · ${allSites.filter(s=>s.priority==='critical').length} críticas`;
  document.getElementById('tvAvg').textContent       = (data.avgProgress||0).toFixed(1) + '%';
  document.getElementById('tvAvgSub').textContent    = `Meta: ${CFG.target}%`;
  document.getElementById('tvComp').textContent      = data.completed || 0;
  document.getElementById('tvCompSub').textContent   = `de ${data.totalSites||0} sites`;
  document.getElementById('tvTitle').textContent     = `📡 ${CFG.name} — Monitoreo en Vivo`;
}

function openTV() {
  document.getElementById('tvOverlay').classList.add('open');
  // Render TV chart
  const ctx = document.getElementById('tvChart').getContext('2d');
  if (tvChartInst) tvChartInst.destroy();
  const colors = { critical:'#ef4444', risk:'#f59e0b', normal:'#10b981' };
  tvChartInst = new Chart(ctx, {
    type:'bar',
    data: {
      labels: allSites.map(s => s.site),
      datasets:[{
        data: allSites.map(s => Math.round(s.progress)),
        backgroundColor: allSites.map(s => colors[s.priority] || '#3b82f6'),
        borderRadius: 6, borderSkipped:false,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        y:{ min:0, max:100, ticks:{color:'rgba(255,255,255,.5)'}, grid:{color:'rgba(255,255,255,.05)'} },
        x:{ ticks:{color:'rgba(255,255,255,.5)'}, grid:{display:false} }
      }
    }
  });
  // Clock
  const upd = () => {
    const now = new Date();
    document.getElementById('tvTime').textContent =
      now.toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  };
  upd();
  tvInterval = setInterval(upd, 1000);
}
function closeTV() {
  document.getElementById('tvOverlay').classList.remove('open');
  clearInterval(tvInterval);
}

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hBrandText').textContent = `📡 ${CFG.name}`;
  if (checkAuth()) cargarDatos();
  // Auto-refresh cada 60 min
  setInterval(() => { if (checkAuth()) cargarDatos(); }, 60 * 60 * 1000);
});
