const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ── State ──
let isRunning = false;
let startTime = null;
let timerInterval = null;
let totalThreads = 0;
let doneThreads = 0;
let successCount = 0;
let failedCount = 0;
let allResults = [];
let currentFilter = 'all';

// ── Tab navigation ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Block non-numeric input on threads field ──
const threadsInput = document.getElementById('q-threads');
threadsInput.addEventListener('keydown', (e) => {
  // Allow: backspace, delete, tab, escape, enter, arrows, home, end
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key)) return;
  // Allow: Ctrl/Cmd+A, C, V, X
  if ((e.ctrlKey || e.metaKey) && ['a','c','v','x'].includes(e.key.toLowerCase())) return;
  // Block anything that's not a digit
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
});
threadsInput.addEventListener('input', () => {
  // Strip any non-digit that snuck in (e.g. paste)
  threadsInput.value = threadsInput.value.replace(/\D/g, '');
  if (threadsInput.value === '') threadsInput.value = '1';
});

// ── Proxy toggle ──
document.getElementById('c-use-proxy').addEventListener('change', function () {
  document.getElementById('proxy-fields').classList.toggle('proxy-hidden', !this.checked);
});

// ── Proxy: count lines ──
function updateProxyCount() {
  const raw = document.getElementById('c-proxy-list').value.trim();
  const count = raw ? raw.split('\n').filter(l => l.trim()).length : 0;
  document.getElementById('proxy-count').textContent = `${count} proxy`;
}
document.getElementById('c-proxy-list').addEventListener('input', updateProxyCount);

// ── Proxy: load file button ──
document.getElementById('btn-load-proxy-file').addEventListener('click', () => {
  document.getElementById('proxy-file-input').click();
});
document.getElementById('proxy-file-input').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('c-proxy-list').value = e.target.result.trim();
    updateProxyCount();
    addLog(`Đã tải ${document.getElementById('proxy-count').textContent} từ file: ${file.name}`, 'success');
  };
  reader.readAsText(file);
  this.value = ''; // reset so same file can be reloaded
});

// ── Proxy: clear list ──
document.getElementById('btn-clear-proxy').addEventListener('click', () => {
  document.getElementById('c-proxy-list').value = '';
  updateProxyCount();
});

// ── Proxy: drag and drop .txt file ──
const dropZone = document.getElementById('proxy-drop-zone');
const dropOverlay = document.getElementById('proxy-drop-overlay');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith('.txt')) { addLog('Chỉ chấp nhận file .txt!', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('c-proxy-list').value = ev.target.result.trim();
    updateProxyCount();
    addLog(`Kéo thả: đã tải ${document.getElementById('proxy-count').textContent} từ ${file.name}`, 'success');
  };
  reader.readAsText(file);
});

// ════════════════════════════════════════
//  ACCOUNTS
// ════════════════════════════════════════

// ── Accounts: count lines ──
function updateAccCount() {
  const raw = document.getElementById('c-acc-list').value.trim();
  const count = raw ? raw.split('\n').filter(l => l.trim()).length : 0;
  document.getElementById('acc-count').textContent = `${count} tài khoản`;
}
document.getElementById('c-acc-list').addEventListener('input', updateAccCount);

// ── Accounts: load file button ──
document.getElementById('btn-load-acc-file').addEventListener('click', () => {
  document.getElementById('acc-file-input').click();
});
document.getElementById('acc-file-input').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('c-acc-list').value = e.target.result.trim();
    updateAccCount();
    addLog(`Đã tải ${document.getElementById('acc-count').textContent} từ file: ${file.name}`, 'success');
  };
  reader.readAsText(file);
  this.value = '';
});

// ── Accounts: clear ──
document.getElementById('btn-clear-acc').addEventListener('click', () => {
  document.getElementById('c-acc-list').value = '';
  updateAccCount();
});

// ── Accounts: drag and drop .txt ──
const accDropZone = document.getElementById('acc-drop-zone');

accDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  accDropZone.classList.add('drag-over');
});
accDropZone.addEventListener('dragleave', (e) => {
  if (!accDropZone.contains(e.relatedTarget)) accDropZone.classList.remove('drag-over');
});
accDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  accDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith('.txt')) { addLog('Chỉ chấp nhận file .txt!', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('c-acc-list').value = ev.target.result.trim();
    updateAccCount();
    addLog(`Kéo thả: đã tải ${document.getElementById('acc-count').textContent} từ ${file.name}`, 'success');
  };
  reader.readAsText(file);
});

// ── Log filters ──
document.querySelectorAll('.log-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    applyFilter();
  });
});
function applyFilter() {
  document.querySelectorAll('.log-entry').forEach(el => {
    el.style.display = (currentFilter === 'all' || el.classList.contains(currentFilter)) ? '' : 'none';
  });
}

// ── Build config from inputs ──
function getConfig() {
  // Proxy list
  const useProxy = document.getElementById('c-use-proxy').checked;
  let proxyList = [];
  if (useProxy) {
    const raw = document.getElementById('c-proxy-list').value.trim();
    proxyList = raw.split('\n').map(l => l.trim()).filter(Boolean);
  }

  // Account list — parse format: username|password|email|apppassword
  const accRaw = document.getElementById('c-acc-list').value.trim();
  const accountList = accRaw
    ? accRaw.split('\n').map(line => {
        const [username = '', password = '', email = '', apppassword = ''] = line.trim().split('|');
        return { username, password, email, apppassword };
      }).filter(a => a.username)
    : [];

  // Login selectors / timings
  const loginSelectors = {
    username: 'input[type="text"], input[placeholder*="Garena"]',
    password: 'input[type="password"]',
    submit:   'button[type="submit"], button.primary',
    delay:    parseInt(document.getElementById('c-sel-delay').value) || 800,
    waitAfter: parseInt(document.getElementById('c-sel-wait').value) || 3000,
  };

  const autoExport = document.getElementById('c-auto-export').value === 'true';
  const rawOutput = document.getElementById('c-output').value.trim() || 'output';
  return {
    url:           document.getElementById('q-url').value.trim() || 'https://google.com',
    threads:       parseInt(document.getElementById('q-threads').value) || 3,
    headless:      document.getElementById('q-headless').value === 'true',
    slowMo:        parseInt(document.getElementById('c-slowmo').value) || 0,
    timeout:       parseInt(document.getElementById('c-timeout').value) || 30000,
    keepOpen:      document.getElementById('c-keep-open').checked,
    proxyList,
    accountList,
    loginSelectors,
    outputDir:     autoExport ? path.resolve(rawOutput) : null,
  };
}

// ── Timer ──
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    document.getElementById('stat-time').textContent = `${mm}:${ss}`;
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ── Status badge ──
function setStatus(state, text) {
  const badge = document.getElementById('status-badge');
  badge.className = `status-badge ${state}`;
  document.getElementById('status-text').textContent = text;
}

// ── Thread pills ──
function buildPills(n) {
  const area = document.getElementById('thread-area');
  area.innerHTML = '';
  for (let i = 1; i <= n; i++) {
    const pill = document.createElement('div');
    pill.className = 'thread-pill running';
    pill.id = `pill-${i}`;
    pill.innerHTML = `<span class="pill-dot"></span> Thread ${i}`;
    area.appendChild(pill);
  }
}
function updatePill(id, state) {
  const pill = document.getElementById(`pill-${id}`);
  if (!pill) return;
  pill.className = `thread-pill ${state}`;
  const icon = state === 'success' ? '✅' : '❌';
  pill.innerHTML = `<span class="pill-dot"></span> ${icon} ${id}`;
}

// ── Log ──
function addLog(msg, type = 'info') {
  const body = document.getElementById('log-body');
  const t = new Date().toLocaleTimeString('vi-VN');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${esc(msg)}</span>`;
  if (currentFilter !== 'all' && !entry.classList.contains(currentFilter)) entry.style.display = 'none';
  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Results table ──
function addResult(r) {
  allResults.push(r);
  const tbody = document.getElementById('results-body');
  const emptyRow = tbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();
  const statusClass = r.status === 'SUCCESS' ? 'success' : 'error';
  const detail = r.status === 'SUCCESS' ? (r.title || '') : (r.error || '');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>#${r.thread}</td>
    <td title="${esc(r.account || '')}">${esc(r.account || '—')}</td>
    <td title="${esc(r.url)}">${esc(r.url)}</td>
    <td><span class="pill ${statusClass}">${r.status}</span></td>
    <td title="${esc(detail)}">${esc(detail)}</td>
    <td>${r.time}</td>`;
  tbody.appendChild(tr);
}

// ── START ──
document.getElementById('btn-start').addEventListener('click', () => {
  if (isRunning) return;
  const config = getConfig();
  isRunning = true;
  totalThreads = config.accountList && config.accountList.length > 0 ? config.accountList.length : config.threads;
  doneThreads = successCount = failedCount = 0;

  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-stop').disabled = false;
  document.getElementById('stat-threads').innerHTML = `0<span class="stat-den">/${totalThreads}</span>`;
  document.getElementById('stat-success').textContent = '0';
  document.getElementById('stat-failed').textContent = '0';
  document.getElementById('stat-time').textContent = '00:00';
  setStatus('running', 'Đang chạy');
  buildPills(config.threads);
  startTimer();
  addLog(`Bắt đầu ${config.threads} luồng → ${config.url}`, 'success');
  ipcRenderer.send('start-run', config);
});

// ── STOP ──
document.getElementById('btn-stop').addEventListener('click', () => ipcRenderer.send('stop-run'));

// ── Clear log ──
document.getElementById('btn-clear-log').addEventListener('click', () => {
  // Clear log body
  document.getElementById('log-body').innerHTML = '';
  // Reset stats counters & display
  if (!isRunning) {
    successCount = 0;
    failedCount = 0;
    doneThreads = 0;
    document.getElementById('stat-threads').innerHTML = `0<span class="stat-den">/0</span>`;
    document.getElementById('stat-success').textContent = '0';
    document.getElementById('stat-failed').textContent = '0';
    document.getElementById('stat-time').textContent = '00:00';
    document.getElementById('thread-area').innerHTML = '<span class="thread-empty">Chưa có luồng nào đang chạy</span>';
    setStatus('idle', 'Sẵn sàng');
  }
});

// ── Open Files ──
document.getElementById('btn-open-success').addEventListener('click', async () => {
  const rawOut = document.getElementById('c-output').value.trim() || 'output';
  const outPath = path.join(path.resolve(rawOut), 'success.txt');
  if (fs.existsSync(outPath)) {
    try {
      await shell.openPath(outPath);
      addLog(`Đã mở file: ${outPath}`, 'info');
    } catch (err) {
      addLog(`Không thể mở file: ${err.message}`, 'error');
    }
  } else {
    addLog('File thành công chưa tồn tại!', 'warning');
  }
});

document.getElementById('btn-open-error').addEventListener('click', async () => {
  const rawOut = document.getElementById('c-output').value.trim() || 'output';
  const outPath = path.join(path.resolve(rawOut), 'error.txt');
  if (fs.existsSync(outPath)) {
    try {
      await shell.openPath(outPath);
      addLog(`Đã mở file: ${outPath}`, 'info');
    } catch (err) {
      addLog(`Không thể mở file: ${err.message}`, 'error');
    }
  } else {
    addLog('File lỗi chưa tồn tại!', 'warning');
  }
});

// ── Clear results ──
document.getElementById('btn-clear-results').addEventListener('click', () => {
  allResults = [];
  document.getElementById('results-body').innerHTML = '<tr class="empty-row"><td colspan="5">Chưa có kết quả nào</td></tr>';
});

document.getElementById('btn-save-config').addEventListener('click', () => {
  document.getElementById('q-url').value = document.getElementById('c-url').value;
  
  try {
    const configData = getConfig();
    const configPath = path.join(__dirname, '..', 'shared_config.json');
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
  } catch (err) {
    console.error("Lỗi khi lưu shared_config.json:", err);
  }

  addLog('Cấu hình đã lưu.', 'success');
  // Switch to runner tab
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="runner"]').classList.add('active');
  document.getElementById('tab-runner').classList.add('active');
});

// ── Sync URL ──
document.getElementById('q-url').addEventListener('input', function() { document.getElementById('c-url').value = this.value; });
document.getElementById('c-url').addEventListener('input', function() { document.getElementById('q-url').value = this.value; });

// ── IPC: log ──
ipcRenderer.on('log', (_, { msg, type }) => addLog(msg, type));

// ── IPC: thread done ──
ipcRenderer.on('thread-done', (_, { threadId, status }) => {
  doneThreads++;
  if (status === 'success') successCount++; else failedCount++;
  updatePill(threadId, status);
  document.getElementById('stat-threads').innerHTML = `${doneThreads}<span class="stat-den">/${totalThreads}</span>`;
  document.getElementById('stat-success').textContent = successCount;
  document.getElementById('stat-failed').textContent = failedCount;
});

// ── IPC: run done ──
ipcRenderer.on('run-done', (_, data) => {
  isRunning = false;
  stopTimer();
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-stop').disabled = true;
  if (data.stopped) {
    setStatus('stopped', 'Đã dừng');
    addLog('Đã dừng tất cả luồng.', 'warning');
  } else {
    setStatus('done', 'Hoàn thành');
    if (data.results) data.results.forEach(addResult);
  }
});
