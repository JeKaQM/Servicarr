const REFRESH_MS = 15000;
let DAYS = 30;
const $ = (s,r=document) => r.querySelector(s);
const $$ = (s,r=document) => Array.from(r.querySelectorAll(s));
const fmtMs = ms => ms==null ? '—' : ms+' ms';
const cls = (ok, status, degraded) => {
  if (!ok) return 'pill down'; // Down = red
  if (degraded) return 'pill warn'; // Degraded = amber
  return 'pill ok'; // Up = green
};

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : (i >= 3 ? 2 : 1);
  return `${v.toFixed(digits)} ${units[i]}`;
}

function fmtRateBps(n) {
  if (n == null || isNaN(n)) return '—';
  return `${fmtBytes(n)}/s`;
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(0)}%`;
}

function fmtFloat(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function fmtTempC(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(0)}°C`;
}

function setResText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setResClass(id, clsName) {
  const el = document.getElementById(id);
  if (el) el.className = clsName;
}

function meterClassForPct(p) {
  if (p == null || isNaN(p)) return '';
  const n = Number(p);
  if (n >= 90) return 'bad';
  if (n >= 75) return 'warn';
  return '';
}

function setMeter(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  if (pct == null || isNaN(pct)) {
    el.style.width = '0%';
    el.classList.remove('warn', 'bad');
    return;
  }
  const p = Math.max(0, Math.min(100, Number(pct)));
  el.style.width = `${p}%`;
  el.classList.remove('warn', 'bad');
  const clsName = meterClassForPct(p);
  if (clsName) el.classList.add(clsName);
}

function applyResourcesVisibility(config) {
  const section = document.getElementById('resources-section');
  if (!section || !config) return;

  const enabled = config.enabled !== false;
  section.classList.toggle('hidden', !enabled);

  const tiles = $$('.resource-tile', section);
  tiles.forEach(t => {
    const kind = t.getAttribute('data-kind');
    let show = true;
    if (kind === 'cpu') show = config.cpu !== false;
    else if (kind === 'mem') show = config.memory !== false;
    else if (kind === 'net') show = config.network !== false;
    else if (kind === 'temp') show = config.temp !== false;
    t.classList.toggle('hidden', !show);
  });
}

async function loadResourcesConfig() {
  try {
    const cfg = await j('/api/admin/resources/config');
    applyResourcesVisibility(cfg);

    // If admin form exists (admin view), hydrate it too.
    if ($('#resourcesEnabled')) {
      $('#resourcesEnabled').checked = cfg.enabled !== false;
      $('#resourcesCPU').checked = cfg.cpu !== false;
      $('#resourcesMemory').checked = cfg.memory !== false;
      $('#resourcesNetwork').checked = cfg.network !== false;
      $('#resourcesTemp').checked = cfg.temp !== false;
    }
  } catch (err) {
    // Not logged in (401) or server doesn't have config yet; leave default visible.
  }
}

async function saveResourcesConfig() {
  const statusEl = $('#resourcesStatus');
  const btn = $('#saveResources');
  if (!btn) return;

  const config = {
    enabled: $('#resourcesEnabled').checked,
    cpu: $('#resourcesCPU').checked,
    memory: $('#resourcesMemory').checked,
    network: $('#resourcesNetwork').checked,
    temp: $('#resourcesTemp').checked,
  };

  await handleButtonAction(
    btn,
    async () => {
      await j('/api/admin/resources/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrf()
        },
        body: JSON.stringify(config)
      });

      // Apply immediately on the public page.
      applyResourcesVisibility(config);

      if (statusEl) {
        statusEl.textContent = 'Resources settings saved successfully';
        statusEl.className = 'status-message success';
        statusEl.classList.remove('hidden');
        setTimeout(() => statusEl.classList.add('hidden'), 3000);
      }
    },
    'Resources settings saved'
  );
}

async function refreshResources() {
  const pill = document.getElementById('resources-pill');
  const host = document.getElementById('resources-host');
  const section = document.getElementById('resources-section');

  // If the entire section is hidden by admin config, skip the fetch.
  if (section && section.classList.contains('hidden')) {
    return;
  }

  try {
    const snap = await j('/api/resources');
    if (host) {
      const h = snap.host ? snap.host : 'Server usage';
      const p = snap.platform ? ` • ${snap.platform}` : '';
      host.textContent = `${h}${p}`;
    }

    // KPI values + meters (only update visible tiles)
    const cpuTile = document.querySelector('#resources-section .resource-tile[data-kind="cpu"]');
    const memTile = document.querySelector('#resources-section .resource-tile[data-kind="mem"]');
    const tempTile = document.querySelector('#resources-section .resource-tile[data-kind="temp"]');
    const netTile = document.querySelector('#resources-section .resource-tile[data-kind="net"]');

    if (!cpuTile || !cpuTile.classList.contains('hidden')) {
      setResText('res-cpu', fmtPct(snap.cpu_percent));
      setMeter('meter-cpu', snap.cpu_percent);
    }

    // CPU detail: cores + breakdown when available
    const parts = [];
    if (snap.cpu_cores != null) parts.push(`${snap.cpu_cores} cores`);
    if (snap.cpu_user_percent != null || snap.cpu_system_percent != null || snap.cpu_iowait_percent != null) {
      const u = snap.cpu_user_percent != null ? `U ${fmtPct(snap.cpu_user_percent)}` : null;
      const s = snap.cpu_system_percent != null ? `S ${fmtPct(snap.cpu_system_percent)}` : null;
      const w = snap.cpu_iowait_percent != null ? `W ${fmtPct(snap.cpu_iowait_percent)}` : null;
      parts.push([u,s,w].filter(Boolean).join(' • '));
    } else if (snap.cpu_percent == null) {
      parts.push('CPU usage unavailable');
    } else {
      parts.push('Total usage');
    }
    if (!cpuTile || !cpuTile.classList.contains('hidden')) {
      setResText('res-cpu-detail', parts.length ? parts.join(' — ') : '—');
    }

    if (!memTile || !memTile.classList.contains('hidden')) {
      setResText('res-mem', fmtPct(snap.mem_percent));
      setMeter('meter-mem', snap.mem_percent);
      setResText('res-mem-detail', (snap.mem_used_bytes != null && snap.mem_total_bytes != null)
        ? `${fmtBytes(snap.mem_used_bytes)} / ${fmtBytes(snap.mem_total_bytes)}`
        : '—');
    }

    // Temperature
    if (!tempTile || !tempTile.classList.contains('hidden')) {
      setResText('res-temp', fmtTempC(snap.temp_c));
      setResText('res-temp-min', fmtTempC(snap.temp_min_c));
      setResText('res-temp-max', fmtTempC(snap.temp_max_c));
      setResText('res-temp-detail', (snap.temp_c == null)
        ? 'Temp unavailable'
        : 'Recorded min/max since start');
    }

    if (!netTile || !netTile.classList.contains('hidden')) {
      setResText('res-net-rx', fmtRateBps(snap.net_rx_bytes_per_sec));
      setResText('res-net-tx', fmtRateBps(snap.net_tx_bytes_per_sec));
      const rx = snap.net_rx_bytes_per_sec == null ? 0 : Number(snap.net_rx_bytes_per_sec);
      const tx = snap.net_tx_bytes_per_sec == null ? 0 : Number(snap.net_tx_bytes_per_sec);
      const netSum = (snap.net_rx_bytes_per_sec == null && snap.net_tx_bytes_per_sec == null)
        ? '—'
        : fmtRateBps(rx + tx);
      setResText('res-net', netSum);
      setResText('res-net-detail', (snap.net_rx_bytes_per_sec == null && snap.net_tx_bytes_per_sec == null)
        ? 'Network metrics unavailable'
        : 'Live throughput');
    }

    // Pill status based on availability
    if (pill) {
      const hasAny = (snap.cpu_percent != null) || (snap.mem_percent != null) || (snap.temp_c != null) || (snap.net_rx_bytes_per_sec != null) || (snap.net_tx_bytes_per_sec != null);
      pill.textContent = hasAny ? 'LIVE' : 'PARTIAL';
      pill.className = hasAny ? 'pill ok' : 'pill warn';
    }
  } catch (e) {
    if (pill) {
      pill.textContent = 'UNAVAILABLE';
      pill.className = 'pill warn';
    }
    if (host) host.textContent = 'Resources unavailable';
    // reset meters
    setMeter('meter-cpu', null);
    setMeter('meter-mem', null);
    setResText('res-temp', '—');
    setResText('res-temp-min', '—');
    setResText('res-temp-max', '—');
    setResText('res-temp-detail', 'Temp unavailable');
    setResText('res-net', '—');
    setResText('res-net-detail', 'Network metrics unavailable');
  }
}

async function j(u,opts) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
  
  try {
    const fetchOpts = Object.assign({
      cache:'no-store',
      credentials:'include',
      signal: controller.signal
    }, opts||{});
    
    const r = await fetch(u, fetchOpts);
    clearTimeout(timeoutId);
    
    // Read response body first, before checking ok
    let result;
    const ct = r.headers.get('content-type')||'';
    try {
      result = ct.includes('json') ? await r.json() : await r.text();
    } catch (parseErr) {
      console.error(`Failed to parse response from ${u}:`, parseErr);
      throw new Error(`Failed to parse response: ${parseErr.message}`);
    }
    
    if(!r.ok) {
      const err = new Error('HTTP '+r.status);
      err.status = r.status;
      err.resp = r;
      err.body = result;
      throw err;
    }
    
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - check your connection');
    }
    throw err;
  }
}

function updCard(id,data) {
  const el = document.getElementById(id);
  if (!el) {
    console.error('Card element not found:', id);
    return;
  }
  
  const pill = $('.pill',el);
  const k = $('.kpi',el);
  const h = $('.kpirow .label',el); // More specific selector for status label
  const toggle = $('.monitorToggle', el);
  
  if (!pill || !k || !h) {
    console.error('Required elements not found in card:', id);
    return;
  }
  
  // Set checkbox state based on disabled flag from server
  if (toggle) {
    toggle.checked = !data.disabled;
  }
  
  if (data.disabled) {
    pill.textContent = 'DISABLED';
    pill.className = 'pill warn';
    k.textContent = '—';
    h.textContent = 'Monitoring disabled';
    return;
  }

  if (data.degraded) {
    pill.textContent = 'DEGRADED';
  } else {
    pill.textContent = data.ok ? 'UP' : 'DOWN';
  }
  pill.className = cls(data.ok, data.status, data.degraded);
  k.textContent = fmtMs(data.ms);
  h.textContent = data.status ? ('HTTP '+data.status) : 'no response';
  
  // Update last check time
  const lastCheckEl = $(`#last-check-${id.split('-').pop()}`);
  if (lastCheckEl) {
    const now = new Date();
    lastCheckEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
}

async function toggleMonitoring(card, enabled) {
  const key = card.getAttribute('data-key');
  try {
    await j('/api/admin/toggle-monitoring', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrf()
      },
      body: JSON.stringify({ service: key, enable: enabled })
    });
    showToast(`Monitoring ${enabled ? 'enabled' : 'disabled'} for ${key}`);
    await refresh();
  } catch (err) {
    console.error('toggle failed', err);
    showToast('Failed to toggle monitoring', 'error');
  }
}

let chart;
function renderChart(overall) {
  if(!window.Chart) return;
  const labels = ['server','plex','overseerr'];
  const vals = labels.map(k => +(overall?.[k]??0).toFixed(1));
  const ctx = document.getElementById('uptimeChart').getContext('2d');
  const data = {labels, datasets:[{label:'Uptime %',data:vals,borderWidth:1}]};
  
  if(chart) {
    chart.data = data;
    chart.update();
    return;
  }
  
  chart = new Chart(ctx, {
    type: 'bar',
    data,
    options: {
      responsive: true,
      plugins: {legend: {display:false}},
      scales: {y: {beginAtZero:true, max:100}}
    }
  });
}

function renderIncidents(items) {
  const list = $('#incidents');
  if(!items?.length) {
    list.innerHTML = '<li class="label">No incidents in last 24h</li>';
    return;
  }
  
  list.innerHTML = items.map(i => {
    const ts = new Date(i.taken_at).toLocaleString();
    return `<li><span class="dot"></span><span>${ts}</span><span class="label"> — ${i.service_key} (${i.http_status||'n/a'})</span></li>`;
  }).join('');
}

function updateServiceStats(metrics) {
  const services = ['server', 'plex', 'overseerr'];
  
  services.forEach(key => {
    const uptimeEl = $(`#uptime-24h-${key}`);
    const avgResponseEl = $(`#avg-response-${key}`);
    
    if (uptimeEl && metrics.overall) {
      const uptime = metrics.overall[key] || 0;
      uptimeEl.textContent = `${uptime.toFixed(1)}%`;
      uptimeEl.className = 'stat-value ' + (uptime >= 99 ? 'good' : uptime >= 95 ? 'warning' : 'bad');
    }
    
    if (avgResponseEl && metrics.series && metrics.series[key]) {
      const data = metrics.series[key];
      let totalMs = 0;
      let count = 0;
      
      data.forEach(point => {
        if (point.avg_ms && point.avg_ms > 0) {
          totalMs += point.avg_ms;
          count++;
        }
      });
      
      if (count > 0) {
        const avgMs = totalMs / count;
        avgResponseEl.textContent = `${Math.round(avgMs)}ms`;
        avgResponseEl.className = 'stat-value ' + (avgMs < 100 ? 'good' : avgMs < 500 ? 'warning' : 'bad');
      } else {
        avgResponseEl.textContent = '—';
        avgResponseEl.className = 'stat-value';
      }
    }
  });
}

function renderUptimeBars(metrics, days) {
  const daysToShow = days || DAYS;
  const services = ['server', 'plex', 'overseerr'];
  const now = new Date();
  const daysAgo = now.getTime() - (daysToShow * 24 * 60 * 60 * 1000);
  
  // Update global timestamp once
  const globalTimestamp = $('#timestamp-global');
  if (globalTimestamp) {
    const today = now.toLocaleDateString();
    globalTimestamp.textContent = `Tracking from ${today} • Hover over blocks for details`;
  }
  
  services.forEach(key => {
    const bar = $(`#uptime-bar-${key}`);
    const uptimePercent = $(`#uptime-${key}`);
    
    if (!bar) return;
    
    // Add data attribute for CSS styling based on day count
    bar.setAttribute('data-days', daysToShow);
    
    const data = (metrics && metrics.series) ? metrics.series[key] || [] : [];
    const overall = (metrics && metrics.overall) ? metrics.overall[key] || 0 : 0;
    
    // Update uptime percentage
    if (uptimePercent) {
      if (data.length === 0) {
        uptimePercent.textContent = 'N/A';
        uptimePercent.style.color = 'var(--text-dim)';
      } else {
        uptimePercent.textContent = `${overall.toFixed(1)}%`;
        uptimePercent.style.color = overall >= 99 ? 'var(--ok)' : overall >= 95 ? 'var(--warn)' : 'var(--down)';
      }
    }
    
    // Clear existing blocks
    bar.innerHTML = '';
    
    // Create blocks for each day - always show DAYS blocks
    // If we have data, use it; otherwise show gray "no data" blocks
    const blocks = [];
    
    if (data.length > 0) {
      // Fill in missing days with null data
      const dataMap = {};
      data.forEach(point => {
        if (point.day) {
          dataMap[point.day] = point;
        }
      });
      
      // Create all days
      for (let i = daysToShow - 1; i >= 0; i--) {
        const dayTime = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const dayBin = dayTime.toISOString().substr(0, 10);
        blocks.push(dataMap[dayBin] || { day: dayBin, uptime: null });
      }
    } else {
      // No data yet - create empty blocks
      for (let i = daysToShow - 1; i >= 0; i--) {
        const dayTime = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const dayBin = dayTime.toISOString().substr(0, 10);
        blocks.push({ day: dayBin, uptime: null });
      }
    }
    
    blocks.forEach((point) => {
      const block = document.createElement('div');
      block.className = 'uptime-block';
      
      const uptime = point.uptime;
      const dayDate = new Date(point.day);
      const formattedDate = dayDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: daysToShow > 90 ? 'numeric' : undefined 
      });
      
      let tooltipText = '';
      if (uptime === null || uptime === undefined) {
        block.classList.add('unknown');
        tooltipText = `${formattedDate}\nNo data available`;
      } else if (uptime >= 99) {
        block.classList.add('up');
        tooltipText = `${formattedDate}\n${uptime.toFixed(1)}% uptime\n✓ Operational`;
      } else if (uptime >= 50) {
        block.classList.add('degraded');
        tooltipText = `${formattedDate}\n${uptime.toFixed(1)}% uptime\n⚠ Degraded performance`;
      } else {
        block.classList.add('down');
        tooltipText = `${formattedDate}\n${uptime.toFixed(1)}% uptime\n✗ Significant downtime`;
      }
      
      block.title = tooltipText;
      block.setAttribute('data-tooltip', tooltipText);
      
      // Add mobile-friendly touch feedback
      block.addEventListener('touchstart', (e) => {
        // Show a quick visual feedback on touch
        block.style.transition = 'transform 0.1s';
        
        // Create temporary tooltip for mobile
        const isMobile = window.innerWidth <= 768;
        if (isMobile && tooltipText) {
          showMobileTooltip(block, tooltipText, e.touches[0]);
        }
      });
      
      block.addEventListener('touchend', () => {
        block.style.transition = '';
      });
      
      bar.appendChild(block);
    });
  });
}

// Mobile tooltip function for uptime blocks
let tooltipTimeout;
function showMobileTooltip(element, text, touch) {
  // Remove any existing tooltip
  const existingTooltip = document.querySelector('.mobile-tooltip');
  if (existingTooltip) {
    existingTooltip.remove();
  }
  
  clearTimeout(tooltipTimeout);
  
  const tooltip = document.createElement('div');
  tooltip.className = 'mobile-tooltip';
  tooltip.textContent = text.replace(/\n/g, ' • ');
  tooltip.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 10000;
    pointer-events: none;
    max-width: 80vw;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    left: 50%;
    top: ${touch ? touch.clientY - 60 : 100}px;
    transform: translateX(-50%);
    animation: fadeIn 0.2s ease-in;
  `;
  
  document.body.appendChild(tooltip);
  
  tooltipTimeout = setTimeout(() => {
    tooltip.style.animation = 'fadeOut 0.2s ease-out';
    setTimeout(() => tooltip.remove(), 200);
  }, 2000);
}

async function refresh() {
  try {
    const live = await j('/api/check');
    $('#updated').textContent = new Date(live.t).toLocaleString();
    updCard('card-server', live.status.server || {});
    updCard('card-plex', live.status.plex || {});
    updCard('card-overseerr', live.status.overseerr || {});
  } catch (e) {
    console.error('live check failed', e);
  }

  // Resources (Glances)
  refreshResources();

  try {
    const metrics = await j(`/api/metrics?days=${DAYS}`);
    $('#window').textContent = `Last ${DAYS} days`;
    
    try {
      renderChart(metrics.overall || {});
    } catch (chartErr) {
      // Chart rendering failed - silent failure
    }
    
    renderIncidents(metrics.downs || []);
    renderUptimeBars(metrics, DAYS);
    
    // Fetch 24h stats for the service cards
    const stats24h = await j('/api/metrics?hours=24');
    updateServiceStats(stats24h);
  } catch (e) {
    // Metrics unavailable - render with no data
    renderUptimeBars(null, DAYS);
  }
}

async function doLoginFlow() {
  const dlg = document.getElementById('loginModal');
  const err = $('#loginError', dlg);
  err.classList.add('hidden');
  err.textContent = '';
  
  // Clear any previous input
  $('#u', dlg).value = '';
  $('#p', dlg).value = '';
  
  dlg.showModal();
}

async function submitLogin() {
  const dlg = document.getElementById('loginModal');
  const u = $('#u', dlg).value.trim();
  const p = $('#p', dlg).value;
  
  if (!u || !p) {
    const el = $('#loginError', dlg);
    el.textContent = 'Username and password are required';
    el.classList.remove('hidden');
    return;
  }
  
  // Disable form while submitting to prevent double submission
  const submitBtn = $('#doLogin');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';
  
  try {
    const csrfToken = getCsrf();
    
    const result = await j('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({username: u, password: p})
    });
    
    dlg.close();
    await whoami();
  } catch (err) {
    console.error('Login error:', err.message);
    
    const el = $('#loginError', dlg);
    
    if (err.status === 403) {
      el.textContent = 'Access denied - too many failed attempts. Try again later.';
    } else if (err.status === 401) {
      el.textContent = 'Invalid username or password';
    } else if (err.name === 'AbortError') {
      el.textContent = 'Request timeout - check your connection';
    } else {
      el.textContent = err.message || 'Login failed. Please try again.';
    }
    
    el.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Login';
  }
}

async function logout() {
  try {
    await j('/api/logout', {method: 'POST'});
  } catch (_) {}
  await whoami();
}

function getCsrf() {
  return (document.cookie.split('; ').find(s => s.startsWith('csrf=')) || '').split('=')[1] || '';
}

// Custom event for login state changes
const loginStateChanged = new Event('loginStateChanged');

async function whoami() {
  try {
    const me = await j('/api/me');
    
    if(me.authenticated) {
      $('#welcome').textContent = 'Welcome, ' + me.user;
      $('#loginBtn').classList.add('hidden');
      $('#logoutBtn').classList.remove('hidden');
      $('#adminPanel').classList.remove('hidden');
      $$('.adminRow').forEach(e => e.classList.remove('hidden'));
      document.dispatchEvent(loginStateChanged);
      loadAlertsConfig();
    } else {
      $('#welcome').textContent = 'Public view';
      $('#loginBtn').classList.remove('hidden');
      $('#logoutBtn').classList.add('hidden');
      $('#adminPanel').classList.add('hidden');
      $$('.adminRow').forEach(e => e.classList.add('hidden'));
      
      // Reset login form
      const dlg = document.getElementById('loginModal');
      if (dlg) {
        const submitBtn = $('#doLogin', dlg);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login';
        }
        const errorEl = $('#loginError', dlg);
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
        $('#u', dlg).value = '';
            document.dispatchEvent(new Event('loginStateChanged'));
            // Visibility config might be admin-only; load after auth state changes.
            loadResourcesConfig();
      }
    }
  } catch (e) {
    console.error('Failed to fetch user info:', e.message);
  }
}

async function handleButtonAction(btn, action, successMsg) {
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await action();
    showToast(successMsg);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Action failed', 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

async function ingestAll() {
  const btn = $('#ingestNowTab') || $('#ingestNow');
  await handleButtonAction(
    btn,
    async () => {
      await j('/api/admin/ingest-now', {
        method: 'POST',
        headers: {'X-CSRF-Token': getCsrf()}
      });
      await refresh();
    },
    'Ingestion completed successfully'
  );
}

async function resetRecent() {
            document.dispatchEvent(new Event('loginStateChanged'));
            // Visibility config might be admin-only; load after auth state changes.
            loadResourcesConfig();
  const btn = $('#resetRecentTab') || $('#resetRecent');
  await handleButtonAction(
    btn,
    async () => {
      await j('/api/admin/reset-recent', {
        method: 'POST',
        headers: {'X-CSRF-Token': getCsrf()}
      });
      await refresh();
    },
    'Recent incidents reset successfully'
  );
}

async function saveAlertsConfig() {
  const statusEl = $('#alertStatus');
  const btn = $('#saveAlerts');
  
  const config = {
    enabled: $('#alertsEnabled').checked,
    smtp_host: $('#smtpHost').value,
    smtp_port: parseInt($('#smtpPort').value) || 587,
    smtp_user: $('#smtpUser').value,
    smtp_password: $('#smtpPassword').value,
    alert_email: $('#alertEmail').value,
    from_email: $('#alertFromEmail').value,
    alert_on_down: $('#alertOnDown').checked,
    alert_on_degraded: $('#alertOnDegraded').checked,
    alert_on_up: $('#alertOnUp').checked
  };
  
  await handleButtonAction(
    btn,
    async () => {
      await j('/api/admin/alerts/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrf()
        },
        body: JSON.stringify(config)
      });
      
      statusEl.textContent = 'Configuration saved successfully';
      statusEl.className = 'status-message success';
      statusEl.classList.remove('hidden');
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    },
    'Configuration saved'
  );
}

async function sendTestEmail() {
  const statusEl = $('#alertStatus');
  const btn = $('#testEmail');
  
  await handleButtonAction(
    btn,
    async () => {
      const result = await j('/api/admin/alerts/test', {
        method: 'POST',
        headers: {'X-CSRF-Token': getCsrf()}
      });
      
      statusEl.textContent = result.message || 'Test email sent successfully';
      statusEl.className = 'status-message success';
      statusEl.classList.remove('hidden');
      setTimeout(() => statusEl.classList.add('hidden'), 5000);
    },
    'Test email sent'
  );
}

async function loadAlertsConfig() {
  try {
    const config = await j('/api/admin/alerts/config');
    if (config) {
      $('#alertsEnabled').checked = config.enabled || false;
      $('#smtpHost').value = config.smtp_host || '';
      $('#smtpPort').value = config.smtp_port || 587;
      $('#smtpUser').value = config.smtp_user || '';
      $('#smtpPassword').value = config.smtp_password || '';
      $('#alertEmail').value = config.alert_email || '';
      $('#alertFromEmail').value = config.from_email || '';
      $('#alertOnDown').checked = config.alert_on_down !== false;
      $('#alertOnDegraded').checked = config.alert_on_degraded !== false;
      $('#alertOnUp').checked = config.alert_on_up || false;
    }
  } catch (err) {
    // No alerts config available
  }
}

async function checkNowFor(card) {
  const btn = $('.checkNow', card);
  const key = card.getAttribute('data-key');
  const toggle = $('.monitorToggle', card);
  
  // Don't allow checks on disabled services
  if (toggle && !toggle.checked) {
    showToast('Cannot check disabled services', 'error');
    return;
  }
  
  await handleButtonAction(
    btn,
    async () => {
      const res = await j('/api/admin/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrf()
        },
        body: JSON.stringify({service: key})
      });
      updCard('card-'+key, res);
      /* also refresh metrics in background */
      refresh();
    },
    `Check completed for ${key}`
  );
}

window.addEventListener('load', () => {
  refresh();
  // Also trigger a quick resources fetch shortly after load so it updates fast.
  setTimeout(() => {
    try { refreshResources(); } catch (_) {}
  }, 500);
  // Load admin-configured visibility (no-op if not logged in)
  loadResourcesConfig();
  whoami();
  setInterval(refresh, REFRESH_MS);
  
  // Handle both click and touch events for login button
  const loginBtn = $('#loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', doLoginFlow);
    loginBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      doLoginFlow();
    });
  }
  
  // Handle both click and touch for doLogin button
  const doLoginBtn = $('#doLogin');
  if (doLoginBtn) {
    doLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      submitLogin();
    });
    doLoginBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      submitLogin();
    });
  }

  // Handle cancel button
  const cancelBtn = $('#cancelLogin');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      $('#loginModal').close();
    });
    cancelBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      $('#loginModal').close();
    });
  }
  
  // Handle both click and touch for logout
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
    logoutBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      logout();
    });
  }
  
  const ingestBtn = $('#ingestNow');
  if (ingestBtn) {
    ingestBtn.addEventListener('click', ingestAll);
  }
  
  const resetBtn = $('#resetRecent');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetRecent);
  }
  
  // Tab functionality in admin panel
  const ingestBtnTab = $('#ingestNowTab');
  if (ingestBtnTab) {
    ingestBtnTab.addEventListener('click', ingestAll);
  }
  
  const resetBtnTab = $('#resetRecentTab');
  if (resetBtnTab) {
    resetBtnTab.addEventListener('click', resetRecent);
  }
  
  // Tab switching
  const tabBtns = $$('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      
      // Update active tab button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update active tab content
      $$('.tab-content').forEach(content => content.classList.remove('active'));
      const activeContent = $(`#tab-${tabName}`);
      if (activeContent) {
        activeContent.classList.add('active');
      }
      
      // Load blocks when security tab is clicked
      if (tabName === 'security') {
        const event = new Event('loginStateChanged');
        document.dispatchEvent(event);
      }
    });
  });
  
  // Alerts form handlers
  const saveAlertsBtn = $('#saveAlerts');
  if (saveAlertsBtn) {
    saveAlertsBtn.addEventListener('click', saveAlertsConfig);
  }
  
  const testEmailBtn = $('#testEmail');
  if (testEmailBtn) {
    testEmailBtn.addEventListener('click', sendTestEmail);
  }

  // Resources config handlers
  const saveResourcesBtn = $('#saveResources');
  if (saveResourcesBtn) {
    saveResourcesBtn.addEventListener('click', saveResourcesConfig);
  }
  
  $$('.checkNow').forEach(btn => 
    btn.addEventListener('click', () => checkNowFor(btn.closest('.card')))
  );

  $$('.monitorToggle').forEach(toggle => 
    toggle.addEventListener('change', (e) => toggleMonitoring(e.target.closest('.card'), e.target.checked))
  );
  
  // Uptime filter dropdown
  const uptimeFilter = $('#uptimeFilter');
  if (uptimeFilter) {
    uptimeFilter.addEventListener('change', async (e) => {
      DAYS = parseInt(e.target.value);
      
      // Fetch new metrics and re-render
      try {
        const metrics = await j(`/api/metrics?days=${DAYS}`);
        $('#window').textContent = `Last ${DAYS} days`;
        renderUptimeBars(metrics, DAYS);
      } catch (err) {
        console.error('Failed to fetch metrics for new time range', err);
        renderUptimeBars(null, DAYS);
      }
    });
  }
});