import {
  TwError,
  decodeTw,
  applyZones,
  buildRawTw,
  zonesToCsv,
  ZONE_CHANNEL_LIMIT
} from './hd1tw.js';
import { parseChannelCsv, channelLabel, channelMeta, CsvError } from './channels.js';
import { parseZoneCsv } from './zones.js';

const $ = (selector) => document.querySelector(selector);

const elements = {
  twFile: $('#twFile'),
  channelFile: $('#channelFile'),
  zoneCsvFile: $('#zoneCsvFile'),
  fileStatus: $('#fileStatus'),
  workspace: $('#workspace'),
  actions: $('#actions'),
  zoneList: $('#zoneList'),
  zoneTotal: $('#zoneTotal'),
  noZone: $('#noZone'),
  zoneEditor: $('#zoneEditor'),
  zoneName: $('#zoneName'),
  zoneCount: $('#zoneCount'),
  zoneChannels: $('#zoneChannels'),
  channelSearch: $('#channelSearch'),
  channelResults: $('#channelResults'),
  channelNumber: $('#channelNumber'),
  addChannelNumber: $('#addChannelNumber'),
  exportCsv: $('#exportCsv'),
  downloadTw: $('#downloadTw'),
  messageBox: $('#messageBox')
};

const state = {
  fileName: '',
  payload: null,
  passes: 0,
  zones: [],
  channelMap: new Map(),
  selectedZoneIndex: null
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showMessage(message, type = '') {
  elements.messageBox.textContent = message;
  elements.messageBox.className = `notice ${type}`.trim();
  elements.messageBox.classList.remove('hidden');
}

function clearMessage() {
  elements.messageBox.classList.add('hidden');
  elements.messageBox.textContent = '';
}

function cloneZones(zones) {
  return zones.map(zone => ({ ...zone, channels: [...zone.channels] }));
}

function selectedZone() {
  return state.zones.find(zone => zone.index === state.selectedZoneIndex) ?? null;
}

function renderZoneList() {
  elements.zoneTotal.textContent = String(state.zones.length);
  elements.zoneList.innerHTML = '';

  for (const zone of state.zones) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `zone-button${zone.index === state.selectedZoneIndex ? ' active' : ''}`;
    button.dataset.zoneIndex = String(zone.index);

    const name = document.createElement('span');
    name.textContent = zone.name;
    const count = document.createElement('small');
    count.textContent = `${zone.channels.length}/64`;
    button.append(name, count);
    elements.zoneList.append(button);
  }
}

function channelRowHtml(channel, position, count) {
  const alias = channelLabel(channel, state.channelMap);
  const meta = channelMeta(channel, state.channelMap);
  return `
    <div class="channel-row" data-position="${position}">
      <div class="channel-number">${channel}</div>
      <div class="channel-main">
        <div class="channel-alias">${escapeHtml(alias)}</div>
        <div class="channel-meta">${escapeHtml(meta || 'Keine Kanallisten-Information geladen')}</div>
      </div>
      <div class="row-actions">
        <button type="button" class="icon" data-action="up" title="Nach oben" ${position === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon" data-action="down" title="Nach unten" ${position === count - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon danger" data-action="remove" title="Entfernen">×</button>
      </div>
    </div>`;
}

function renderZoneEditor() {
  const zone = selectedZone();
  if (!zone) {
    elements.noZone.classList.remove('hidden');
    elements.zoneEditor.classList.add('hidden');
    return;
  }

  elements.noZone.classList.add('hidden');
  elements.zoneEditor.classList.remove('hidden');
  elements.zoneName.value = zone.name;
  elements.zoneCount.textContent = `${zone.channels.length} / ${ZONE_CHANNEL_LIMIT}`;
  elements.zoneChannels.innerHTML = zone.channels.length
    ? zone.channels.map((ch, pos) => channelRowHtml(ch, pos, zone.channels.length)).join('')
    : '<div class="empty-state">Diese Zone enthält keine Kanäle.</div>';

  renderChannelSearch();
}

function renderAll() {
  renderZoneList();
  renderZoneEditor();
}

function renderChannelSearch() {
  const zone = selectedZone();
  if (!zone || !state.channelMap.size) {
    elements.channelSearch.disabled = true;
    elements.channelResults.innerHTML = '';
    return;
  }

  elements.channelSearch.disabled = false;
  const query = elements.channelSearch.value.trim().toLowerCase();
  if (!query) {
    elements.channelResults.innerHTML = '<div class="muted">Suchbegriff eingeben.</div>';
    return;
  }

  const inZone = new Set(zone.channels);
  const results = [...state.channelMap.values()]
    .filter(ch => !inZone.has(ch.number))
    .filter(ch => `${ch.number} ${ch.alias} ${ch.rx} ${ch.tx} ${ch.type}`.toLowerCase().includes(query))
    .slice(0, 50);

  if (!results.length) {
    elements.channelResults.innerHTML = '<div class="muted">Keine passenden Kanäle gefunden.</div>';
    return;
  }

  elements.channelResults.innerHTML = results.map(ch => `
    <div class="search-row">
      <div class="channel-number">${ch.number}</div>
      <div class="channel-main">
        <div class="channel-alias">${escapeHtml(ch.alias)}</div>
        <div class="channel-meta">${escapeHtml(channelMeta(ch.number, state.channelMap))}</div>
      </div>
      <button type="button" class="secondary" data-add-channel="${ch.number}">+</button>
    </div>`).join('');
}

function addChannel(number) {
  const zone = selectedZone();
  if (!zone) return;
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    showMessage('Bitte eine gültige Kanalnummer zwischen 1 und 65535 angeben.', 'error');
    return;
  }
  if (zone.channels.includes(number)) {
    showMessage(`Kanal ${number} ist bereits in der Zone enthalten.`, 'error');
    return;
  }
  if (zone.channels.length >= ZONE_CHANNEL_LIMIT) {
    showMessage('Die Zone enthält bereits 64 Kanäle.', 'error');
    return;
  }

  zone.channels.push(number);
  clearMessage();
  renderAll();
}

function moveChannel(position, delta) {
  const zone = selectedZone();
  if (!zone) return;
  const next = position + delta;
  if (position < 0 || next < 0 || position >= zone.channels.length || next >= zone.channels.length) return;
  [zone.channels[position], zone.channels[next]] = [zone.channels[next], zone.channels[position]];
  renderAll();
}

function removeChannel(position) {
  const zone = selectedZone();
  if (!zone || position < 0 || position >= zone.channels.length) return;
  zone.channels.splice(position, 1);
  renderAll();
}

function downloadBlob(content, type, fileName) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputBaseName() {
  return (state.fileName || 'codeplug.tw').replace(/\.tw$/i, '');
}

async function loadTw(file) {
  clearMessage();
  elements.fileStatus.textContent = 'Codeplug wird dekodiert …';

  const decoded = decodeTw(await file.arrayBuffer());
  state.fileName = file.name;
  state.payload = decoded.payload;
  state.passes = decoded.passes;
  state.zones = cloneZones(decoded.zones);
  state.selectedZoneIndex = state.zones[0]?.index ?? null;

  elements.zoneCsvFile.disabled = false;
  elements.workspace.classList.remove('hidden');
  elements.actions.classList.remove('hidden');
  elements.fileStatus.textContent = `${file.name} · ${decoded.passes} Decoder-Durchläufe · ${decoded.payload.length.toLocaleString('de-DE')} Byte RAW · ${decoded.zones.length} Zonen`;
  renderAll();
}

async function loadChannels(file) {
  clearMessage();
  const text = await file.text();
  state.channelMap = parseChannelCsv(text);
  showMessage(`${state.channelMap.size.toLocaleString('de-DE')} Kanäle aus ${file.name} geladen.`, 'success');
  renderAll();
}

async function importZones(file) {
  if (!state.payload) return;
  const allowed = new Set(state.zones.map(zone => zone.index));
  const imported = parseZoneCsv(await file.text(), allowed);

  for (const incoming of imported) {
    const current = state.zones.find(zone => zone.index === incoming.index);
    current.name = incoming.name;
    current.channels = [...incoming.channels];
  }

  showMessage(`${imported.length} vorhandene Zonen aus ${file.name} übernommen.`, 'success');
  renderAll();
}

elements.twFile.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadTw(file);
  } catch (error) {
    console.error(error);
    elements.workspace.classList.add('hidden');
    elements.actions.classList.add('hidden');
    state.payload = null;
    showMessage(error instanceof TwError ? error.message : `Codeplug konnte nicht geladen werden: ${error.message}`, 'error');
    elements.fileStatus.textContent = 'Codeplug konnte nicht geladen werden.';
  }
});

elements.channelFile.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadChannels(file);
  } catch (error) {
    console.error(error);
    showMessage(error instanceof CsvError ? error.message : `Kanalliste konnte nicht geladen werden: ${error.message}`, 'error');
  }
});

elements.zoneCsvFile.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importZones(file);
  } catch (error) {
    console.error(error);
    showMessage(error instanceof CsvError ? error.message : `Zonen-CSV konnte nicht importiert werden: ${error.message}`, 'error');
  } finally {
    event.target.value = '';
  }
});

elements.zoneList.addEventListener('click', event => {
  const button = event.target.closest('[data-zone-index]');
  if (!button) return;
  state.selectedZoneIndex = Number.parseInt(button.dataset.zoneIndex, 10);
  clearMessage();
  renderAll();
});

elements.zoneName.addEventListener('input', event => {
  const zone = selectedZone();
  if (!zone) return;
  zone.name = event.target.value;
  renderZoneList();
});

elements.zoneChannels.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  const row = event.target.closest('[data-position]');
  if (!button || !row) return;
  const position = Number.parseInt(row.dataset.position, 10);
  if (button.dataset.action === 'up') moveChannel(position, -1);
  if (button.dataset.action === 'down') moveChannel(position, 1);
  if (button.dataset.action === 'remove') removeChannel(position);
});

elements.channelSearch.addEventListener('input', renderChannelSearch);
elements.channelResults.addEventListener('click', event => {
  const button = event.target.closest('[data-add-channel]');
  if (!button) return;
  addChannel(Number.parseInt(button.dataset.addChannel, 10));
});

elements.addChannelNumber.addEventListener('click', () => {
  addChannel(Number.parseInt(elements.channelNumber.value, 10));
  elements.channelNumber.value = '';
});

elements.exportCsv.addEventListener('click', () => {
  if (!state.zones.length) return;
  downloadBlob(zonesToCsv(state.zones, state.channelMap), 'text/csv;charset=utf-8', `${outputBaseName()}-zones.csv`);
});

elements.downloadTw.addEventListener('click', () => {
  try {
    if (!state.payload) return;
    const editedPayload = applyZones(state.payload, state.zones);
    const tw = buildRawTw(editedPayload);
    downloadBlob(new Blob([tw], { type: 'application/octet-stream' }), 'application/octet-stream', `${outputBaseName()}-hd1-programmer.tw`);
    showMessage('TW-Datei erzeugt. Bitte jetzt in der Ailunce CPS öffnen und die Zonen prüfen, bevor du sie ins Funkgerät schreibst.', 'success');
  } catch (error) {
    console.error(error);
    showMessage(error instanceof TwError ? error.message : `TW-Datei konnte nicht erzeugt werden: ${error.message}`, 'error');
  }
});
