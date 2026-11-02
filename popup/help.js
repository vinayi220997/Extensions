// Help & troubleshooting view (static content built with the DOM helper).
import { h } from '../ui/dom.js';
import { ctx } from './ctx.js';
import { setFooter } from './app.js';

const $ = (id) => document.getElementById(id);
let built = false;

const chip = (text, cls = 'kind') => h('span', { class: `chip ${cls}`, text });
const p = (...c) => h('p', {}, ...c);
const ul = (...items) => h('ul', {}, ...items.map((i) => h('li', {}, ...[].concat(i))));
const b = (t) => h('b', { text: t });

const SECTIONS = [
  ['Getting started', true, () => [
    h('ol', {},
      h('li', {}, 'Open a page with a video and ', b('press play'), '. Streaming players only load their stream once playback starts.'),
      h('li', {}, 'The number on the VidPull icon shows how many media were found.'),
      h('li', {}, 'Open VidPull, pick a quality and click ', b('Download'), '. Files go to ', h('code', { text: 'Downloads/VidPull' }), ' unless you change it in Settings.'))
  ]],
  ['What the labels mean', false, () => [
    ul(
      [chip('MP4'), ' ', chip('WEBM'), ' … a plain media file — saved directly by Chrome.'],
      [chip('HLS'), ' an .m3u8 stream (most sites). Downloaded piece by piece and converted to MP4.'],
      [chip('DASH'), ' an .mpd stream. Video and audio usually come separately and are merged into one MP4.'],
      [chip('BLOB'), ' an in-page video. Saved straight from the page while it is open.'],
      [chip('Live', 'live'), ' a live broadcast — recording runs until you press ', b('Stop & save'), '.'],
      [chip('AES'), ' encrypted with a standard key that VidPull can decrypt.'],
      [chip('DRM', 'warn'), ' copy-protected (Widevine, PlayReady, FairPlay…). Always listed with what was identified (system, encryption, protocol, licence server, qualities) and why it can\u2019t be saved; never downloaded. ', b('Official download'), ' opens the provider\u2019s own offline instructions where they exist. Filter them with the DRM chip.'])
  ]],
  ['Downloading: quality, format, audio', false, () => [
    ul(
      [b('Quality'), ': choose it in the dropdown on each card. The default comes from Settings › Default resolution.'],
      [b('Download as…'), ' (⋯ menu): pick quality, format (MP4, original .ts, video only, audio only), file name and folder.'],
      [b('Download audio'), ': saves an .m4a. Works for MP4 files, HLS and DASH streams.'],
      [b('Always download audio / Always copy link — all websites'), ': makes that the main button everywhere (also in Settings › Behaviour › Default action). Choose it again to switch back to Download.'],
      [b('… — only on this site'), ': the same for one website; it overrides the global default there.'],
      [b('Pause / Resume'), ': in the Downloads tab, a card’s ⋯ menu, or the Mini view. Live recordings use Stop & save instead.'],
      [b('Rename'), ' changes the title used for the file name. ', b('Smart naming'), ' sets a pattern (and optionally a title picked from the page) for every download from a site.'])
  ]],
  ['Main screen: filters, views, refresh', false, () => [
    ul(
      [b('Filters'), ': All, Video, Audio, Streams (HLS/DASH) and Files. The search box filters by title or address.'],
      [b('Sort by'), ': date added, name, duration, file size, quality, website or download status. Sorting works together with filters and search.'],
      ['Every card shows the duration (', h('code', { text: '–:––' }), ' while unknown), the size — ', h('code', { text: '~' }), ' means estimated from the stream bitrate — plus resolution, codecs and download status.'],
      [b('List / Grid'), ': the grid button switches card layouts; your choice is remembered.'],
      [b('Refresh list'), ' rescans the page; ', b('Refresh page'), ' reloads it; ', b('Clear list'), ' empties the list for this tab.'])
  ]],
  ['Saved links & categories', false, () => [
    p('Keep videos and pages to come back to later. Videos and Pages are separate lists.'),
    ul(
      ['Save a video: ⋯ › ', b('Save to list'), ' or right-click it › VidPull › Save video to list.'],
      ['Save the page: the ', b('bookmark'), ' button at the top, or right-click › VidPull › Save this page to list.'],
      ['Categories: ⋯ in the Saved tab › New category / Manage categories (rename, recolour, delete).'],
      ['Each item can be opened, downloaded, copied, edited, moved or deleted from its ⋯ menu.'])
  ]],
  ['Expired links & refreshing', false, () => [
    p('Many sites give videos temporary addresses that stop working after hours or days.'),
    ul(
      [b('Check link'), ' tests whether the saved address still works (', chip('Link OK', 'good'), ' / ', chip('Expired', 'bad'), ').'],
      [b('Refresh link'), ' opens the video’s page in the background, finds the same video again and replaces the old address.'],
      'If refreshing can’t find the video (some sites only load it after you press play), open the page, play the video and save it again.')
  ]],
  ['Sidebar, window and pinning', false, () => [
    ul(
      [b('Page sidebar'), ': VidPull\u2019s own sidebar docked at the right edge of web pages. Show it from the panel menu, the right-click menu, or make it the toolbar icon\u2019s default (Settings › Appearance › Default panel). Close it with ×.'],
      ['Three icon buttons at the top switch its mode (hover them for a tooltip): ', b('Max'), ' — the full sidebar (drag its left edge to resize); ', b('Mini'), ' — a narrow column (5–10 % of the window) with thumbnail, progress ring (square while paused), duration, size and a download button; ', b('Auto-hide'), ' — only a small arrow handle at the edge. Hover or click the handle (your choice in Settings › Sidebar) to slide the sidebar out; click the Auto-hide button again to pin it back at its previous size.'],
      ['VidPull remembers the mode, both widths, the handle position and the auto-hide trigger. The page is shrunk next to the sidebar so nothing is covered (or choose Overlay).'],
      ['Only one sidebar is open at a time: opening Chrome\u2019s side panel closes the page sidebar, and the other way round. In Mini, the \u00d7 at the top closes it. On app-style sites (fixed full-screen layouts, such as chat apps) the page is narrowed too, so the sidebar never sits on top of it.'],
      [b('Toolbar pin is separate'), ': pinning the VidPull icon to Chrome\u2019s toolbar is done in Chrome\u2019s puzzle-piece menu. VidPull never changes it, and sidebar modes don\u2019t affect it.'],
      ['The panel button (next to Help) opens VidPull as a ', b('popup'), ', in the ', b('sidebar'), ', a ', b('separate window'), ' or a ', b('tab'), '.'],
      [b('Keep on top'), ' (panel menu) keeps a small VidPull window above other windows using Chrome Picture-in-Picture. Use it from the window view.'],
      ['Settings › Appearance › Default panel decides what the toolbar icon opens.'])
  ]],
  ['Right-click menu & shortcuts', false, () => [
    ul(
      ['Right-click a video: download it, download its audio, copy its link or save it.'],
      ['Right-click a page: download the best media, its audio, save the page, rescan, or open VidPull in the sidebar/window.'],
      ['Right-click the VidPull icon: sidebar, window, saved links, history, help, settings.'],
      [h('kbd', { text: 'Alt+Shift+V' }), ' opens VidPull · ', h('kbd', { text: 'Alt+Shift+D' }), ' downloads the best media. Change them at chrome://extensions/shortcuts.'])
  ]],
  ['Addons & custom scripts', false, () => [
    p('Settings › Addons lets you add detection rules for sites VidPull doesn’t understand yet.'),
    ul(
      [b('Rule addons'), ' (.json): extra URL patterns and CSS selectors. No code, work immediately.'],
      [b('Script addons'), ' (.js): run your own JavaScript on matching pages and call ', h('code', { text: 'VidPull.report([...])' }), '. Chrome requires turning on “Allow User Scripts” for VidPull at chrome://extensions first.'],
      'Only install addons you trust — scripts run on the pages they match.')
  ]],
  ['Troubleshooting', false, () => [
    ul(
      [b('Nothing detected'), ': play the video for a few seconds, then click Refresh list. Still nothing? Reload the page and play again, or lower Settings › Ignore files smaller than.'],
      [b('“DRM-protected”'), ': the site uses copy protection. The decryption keys stay inside the browser\u2019s protected module, so VidPull can\u2019t (and won\u2019t) save the video. Open \u24d8 on the card for the details. Plain AES-128 HLS is not DRM and downloads normally.'],
      [b('“Streaming player” notice'), ': the page feeds video to its player in pieces. Play the video so VidPull can find the underlying stream.'],
      [b('HTTP 403 / Server refused access'), ': the address expired or needs the page open. Reload the page, play the video and try again.'],
      [b('No sound in the file'), ': turn on Settings › Merge separate audio and video, or also download the audio track.'],
      [b('File plays oddly'), ': set Settings › HLS stream output to “Original (.ts)” and download again.'],
      [b('Download stuck'), ': cancel it in the Downloads tab and press Retry. Very long streams need enough free memory.'],
      [b('Saved link expired'), ': use Refresh link in the Saved tab.'])
  ]],
  ['Privacy & fair use', false, () => [
    p('VidPull works entirely in your browser. It sends nothing to any server except the websites you download from.'),
    p('Only download content you have the right to save, and respect each website’s terms.')
  ]]
];

export function show() {
  if (!built) {
    built = true;
    $('view-help').append(h('div', { class: 'help' },
      h('h2', { text: 'Help' }),
      ...SECTIONS.map(([title, open, body]) => h('details', { open }, h('summary', { text: title }), h('div', { class: 'content' }, ...body())))));
  }
  if (ctx.view === 'help') setFooter('VidPull help', 'Open in a tab', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=tab&view=help') }));
}
