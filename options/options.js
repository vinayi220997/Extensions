import { getSettings, saveSettings, resetSettings } from '../lib/settings.js';
import { buildFilename, sanitizeFolder } from '../lib/util.js';

const form = document.getElementById('form');
let saveTimer = null;

function fill(s) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = s[el.name];
  }
  preview();
  document.querySelector('[name="historyDays"]').disabled = !s.historyEnabled;
}

function read() {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

function preview() {
  const v = read();
  const name = buildFilename(v.filenameTemplate, { title: 'Big Buck Bunny', host: 'example.com', res: '1080p' });
  const folder = sanitizeFolder(v.subfolder);
  document.getElementById('namePreview').textContent = `Example: Downloads/${folder ? folder + '/' : ''}${name}.mp4`;
}

async function save() {
  const next = await saveSettings(read());
  const status = document.getElementById('saved');
  status.textContent = 'Saved ✓';
  setTimeout(() => { status.textContent = ''; }, 1500);
  document.querySelector('[name="historyDays"]').disabled = !next.historyEnabled;
}

form.addEventListener('input', (e) => {
  if (e.target.name === 'filenameTemplate' || e.target.name === 'subfolder') preview();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, e.target.type === 'text' ? 400 : 0);
});
form.addEventListener('change', () => { clearTimeout(saveTimer); save(); });
form.addEventListener('submit', (e) => e.preventDefault());

document.getElementById('reset').addEventListener('click', async () => {
  fill(await resetSettings());
});

async function refreshHistoryInfo() {
  const { history = [] } = await chrome.storage.local.get('history');
  document.getElementById('historyInfo').textContent = `${history.length} download${history.length === 1 ? '' : 's'} recorded`;
}
document.getElementById('clearHistory').addEventListener('click', async () => {
  if (!confirm('Remove all entries from the download history? Files on disk are kept.')) return;
  await chrome.runtime.sendMessage({ type: 'clear-history' });
  refreshHistoryInfo();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) refreshHistoryInfo();
});

getSettings().then(fill);
refreshHistoryInfo();
