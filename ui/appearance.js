// Applies theme, accent colour, text size and window size to an extension page.
export const ACCENTS = {
  orange: ['#ea580c', '#fb923c'], // VidPull brand
  teal: ['#0f766e', '#2dd4bf'],
  blue: ['#2563eb', '#60a5fa'],
  violet: ['#7c3aed', '#a78bfa'],
  rose: ['#e11d48', '#fb7185'],
  green: ['#15803d', '#4ade80'],
  slate: ['#334155', '#cbd5e1']
};

export const WINDOW_SIZES = {
  S: { width: 360, height: 480 },
  M: { width: 420, height: 580 },
  L: { width: 540, height: 600 } // Chrome caps popups at 800×600
};

const TEXT_SIZES = { S: '12px', M: '13px', L: '14.5px' };
const media = matchMedia('(prefers-color-scheme: dark)');
let current = null;

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function isDark(settings) {
  return settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
}

export function applyAppearance(settings, { sizeBody = false } = {}) {
  current = settings;
  const root = document.documentElement;
  const dark = isDark(settings);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const pair = settings.accent === 'custom' ? [settings.accentCustom, settings.accentCustom] : (ACCENTS[settings.accent] || ACCENTS.orange);
  const accent = dark ? pair[1] : pair[0];
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-text', luminance(accent) > 0.45 ? '#0b1513' : '#ffffff');
  root.style.setProperty('--font-size', TEXT_SIZES[settings.textSize] || TEXT_SIZES.M);
  root.dataset.text = settings.textSize;
  root.dataset.size = settings.windowSize;
  if (sizeBody) {
    const s = WINDOW_SIZES[settings.windowSize] || WINDOW_SIZES.M;
    document.body.style.width = `${s.width}px`;
    document.body.style.height = `${s.height}px`;
  }
}

media.addEventListener('change', () => { if (current && current.theme === 'system') applyAppearance(current); });
