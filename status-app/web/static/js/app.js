const REFRESH_MS = 15000, HOURS = 24;
const $ = (s,r=document) => r.querySelector(s);
const $$ = (s,r=document) => Array.from(r.querySelectorAll(s));
const fmtMs = ms => ms==null ? '—' : ms+' ms';
const cls = (ok, status, degraded) => {
  if (!ok) return 'pill down'; // Down = red
  if (degraded) return 'pill warn'; // Degraded = amber
  return 'pill ok'; // Up = green
};

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
  const pill = $('.pill',el), k = $('.kpi',el), h = $('.label',el);
  const toggle = $('.monitorToggle', el);
  
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

  try {
    const metrics = await j(`/api/metrics?hours=${HOURS}`);
    $('#window').textContent = `Last ${HOURS}h`;
    renderChart(metrics.overall || {});
    renderIncidents(metrics.downs || []);
  } catch (e) {
    console.warn('metrics unavailable yet', e);
  }
}

async function doLoginFlow() {
  console.log('doLoginFlow called');
  const dlg = document.getElementById('loginModal');
  const err = $('#loginError', dlg);
  err.classList.add('hidden');
  err.textContent = '';
  
  // Clear any previous input
  $('#u', dlg).value = '';
  $('#p', dlg).value = '';
  
  console.log('Showing login modal');
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
        $('#p', dlg).value = '';
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
  if(!confirm('Reset incidents recorded in last 24h?')) return;
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
    console.log('No alerts config found or error loading:', err);
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
  
  $$('.checkNow').forEach(btn => 
    btn.addEventListener('click', () => checkNowFor(btn.closest('.card')))
  );

  $$('.monitorToggle').forEach(toggle => 
    toggle.addEventListener('change', (e) => toggleMonitoring(e.target.closest('.card'), e.target.checked))
  );
});