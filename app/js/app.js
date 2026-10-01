import {
  TwError,
  decodeTw,
  applyZoneChanges,
  buildRawTw,
  zonesToCsv,
  ZONE_CHANNEL_LIMIT,
  ZONE_SCAN_SLOTS,
  findFreeZoneSlot,
  isZoneSlotEmpty
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
  changesCard: $('#changesCard'),
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
  newZone: $('#newZone'),
  deleteZone: $('#deleteZone'),
  resetChanges: $('#resetChanges'),
  changeSummary: $('#changeSummary'),
  dirtyBadge: $('#dirtyBadge'),
  exportCsv: $('#exportCsv'),
  downloadTw: $('#downloadTw'),
  messageBox: $('#messageBox')
};

const state = {
  fileName: '',
  payload: null,
  passes: 0,
  originalZones: [],
  zones: [],
  channelMap: new Map(),
  selectedZoneIndex: null,
  draggedPosition: null
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

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function collectChanges() {
  const changes = [];
  const before = new Map(state.originalZones.map(zone => [zone.index, zone]));
  const after = new Map(state.zones.map(zone => [zone.index, zone]));

  for (const zone of state.originalZones) {
    if (!after.has(zone.index)) {
      changes.push({ type: 'deleted', text: `Zone „${zone.name}“ gelöscht` });
    }
  }

  for (const zone of state.zones) {
    const original = before.get(zone.index);
    if (!original) {
      changes.push({ type: 'added', text: `Zone „${zone.name}“ neu angelegt (${zone.channels.length} Kanäle)` });
      continue;
    }

    if (original.name !== zone.name) {
      changes.push({ type: 'renamed', text: `Zone „${original.name}“ in „${zone.name}“ umbenannt` });
    }

    if (!sameArray(original.channels, zone.channels)) {
      if (original.channels.length !== zone.channels.length) {
        changes.push({
          type: 'channels',
          text: `Zone „${zone.name}“: ${original.channels.length} → ${zone.channels.length} Kanäle`
        });
      } else {
        changes.push({ type: 'channels', text: `Zone „${zone.name}“: Kanalbelegung oder Reihenfolge geändert` });
      }
    }
  }

  return changes;
}

function renderChangeSummary() {
  const changes = collectChanges();
  const dirty = changes.length > 0;

  elements.dirtyBadge.classList.toggle('hidden', !dirty);
  elements.resetChanges.disabled = !dirty;

  if (!dirty) {
    elements.changeSummary.className = 'change-summary';
    elements.changeSummary.textContent = 'Keine Änderungen am geladenen Codeplug.';
    return;
  }

  elements.changeSummary.className = 'change-summary has-changes';
  elements.changeSummary.innerHTML = `
    <ul class="change-list">
      ${changes.map(change => `<li>${escapeHtml(change.text)}</li>`).join('')}
    </ul>`;
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
    <div class="channel-row" data-position="${position}" draggable="true">
      <div class="drag-handle" title="Ziehen zum Verschieben" aria-hidden="true">↕</div>
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

  elements.deleteZone.disabled = state.zones.length <= 1;
  renderChannelSearch();
}

function renderAll() {
  renderZoneList();
  renderZoneEditor();
  renderChangeSummary();
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

function moveChannelTo(from, to) {
  const zone = selectedZone();
  if (!zone || from === to || from < 0 || to < 0 || from >= zone.channels.length || to >= zone.channels.length) return;
  const [channel] = zone.channels.splice(from, 1);
  zone.channels.splice(to, 0, channel);
  renderAll();
}

function removeChannel(position) {
  const zone = selectedZone();
  if (!zone || position < 0 || position >= zone.channels.length) return;
  zone.channels.splice(position, 1);
  renderAll();
}

function nextZoneSlot() {
  const used = new Set(state.zones.map(zone => zone.index));
  const released = state.originalZones.find(zone => !used.has(zone.index));
  if (released) return released.index;
  return findFreeZoneSlot(state.payload, used);
}

function createZone() {
  if (!state.payload) return;
  const slot = nextZoneSlot();
  if (slot < 0) {
    showMessage(`Kein freier Zonenslot innerhalb der ${ZONE_SCAN_SLOTS} unterstützten Slots gefunden.`, 'error');
    return;
  }

  let suffix = state.zones.length + 1;
  let name = `ZONE ${suffix}`;
  const names = new Set(state.zones.map(zone => zone.name));
  while (names.has(name)) name = `ZONE ${++suffix}`;

  state.zones.push({ index: slot, name, channels: [] });
  state.zones.sort((a, b) => a.index - b.index);
  state.selectedZoneIndex = slot;
  clearMessage();
  renderAll();
  elements.zoneName.focus();
  elements.zoneName.select();
}

function deleteSelectedZone() {
  const zone = selectedZone();
  if (!zone) return;
  if (state.zones.length <= 1) {
    showMessage('Mindestens eine Zone muss erhalten bleiben.', 'error');
    return;
  }
  if (!window.confirm(`Zone „${zone.name}“ wirklich löschen?`)) return;

  const currentPosition = state.zones.findIndex(item => item.index === zone.index);
  state.zones.splice(currentPosition, 1);
  const next = state.zones[Math.min(currentPosition, state.zones.length - 1)] ?? state.zones[0];
  state.selectedZoneIndex = next?.index ?? null;
  clearMessage();
  renderAll();
}

function validateZoneSlots() {
  if (!state.zones.length) throw new TwError('Mindestens eine Zone muss vorhanden sein.');
  const originalIndices = new Set(state.originalZones.map(zone => zone.index));
  const seen = new Set();

  for (const zone of state.zones) {
    if (seen.has(zone.index)) throw new TwError(`Zonenslot ${zone.index} ist doppelt belegt.`);
    seen.add(zone.index);

    if (!originalIndices.has(zone.index) && !isZoneSlotEmpty(state.payload, zone.index)) {
      throw new TwError(`Zonenslot ${zone.index} ist im ursprünglichen Codeplug nicht leer und kann nicht sicher neu belegt werden.`);
    }
  }
}

function resetChanges() {
  if (!collectChanges().length) return;
  if (!window.confirm('Alle Änderungen an den Zonen verwerfen?')) return;
  state.zones = cloneZones(state.originalZones);
  state.selectedZoneIndex = state.zones[0]?.index ?? null;
  clearMessage();
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
  state.originalZones = cloneZones(decoded.zones);
  state.zones = cloneZones(decoded.zones);
  state.selectedZoneIndex = state.zones[0]?.index ?? null;

  elements.zoneCsvFile.disabled = false;
  elements.workspace.classList.remove('hidden');
  elements.actions.classList.remove('hidden');
  elements.changesCard.classList.remove('hidden');
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
  const imported = parseZoneCsv(await file.text());
  const originalIndices = new Set(state.originalZones.map(zone => zone.index));

  for (const incoming of imported) {
    if (incoming.index >= ZONE_SCAN_SLOTS) {
      throw new CsvError(`ZoneIndex ${incoming.index} liegt außerhalb der unterstützten Zonenslots 0 bis ${ZONE_SCAN_SLOTS - 1}.`);
    }

    let current = state.zones.find(zone => zone.index === incoming.index);
    if (!current) {
      if (!originalIndices.has(incoming.index) && !isZoneSlotEmpty(state.payload, incoming.index)) {
        throw new CsvError(`ZoneIndex ${incoming.index} ist im geladenen Codeplug nicht leer und kann nicht sicher neu angelegt werden.`);
      }
      current = { index: incoming.index, name: incoming.name, channels: [] };
      state.zones.push(current);
    }

    current.name = incoming.name;
    current.channels = [...incoming.channels];
  }

  state.zones.sort((a, b) => a.index - b.index);
  if (!state.zones.some(zone => zone.index === state.selectedZoneIndex)) {
    state.selectedZoneIndex = state.zones[0]?.index ?? null;
  }

  showMessage(`${imported.length} Zonen aus ${file.name} übernommen.`, 'success');
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
    elements.changesCard.classList.add('hidden');
    state.payload = null;
    state.originalZones = [];
    state.zones = [];
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
  renderChangeSummary();
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

elements.zoneChannels.addEventListener('dragstart', event => {
  const row = event.target.closest('[data-position]');
  if (!row) return;
  state.draggedPosition = Number.parseInt(row.dataset.position, 10);
  row.classList.add('dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(state.draggedPosition));
  }
});

elements.zoneChannels.addEventListener('dragover', event => {
  const row = event.target.closest('[data-position]');
  if (!row) return;
  event.preventDefault();
  elements.zoneChannels.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
  row.classList.add('drag-over');
});

elements.zoneChannels.addEventListener('drop', event => {
  const row = event.target.closest('[data-position]');
  if (!row || state.draggedPosition === null) return;
  event.preventDefault();
  const targetPosition = Number.parseInt(row.dataset.position, 10);
  moveChannelTo(state.draggedPosition, targetPosition);
  state.draggedPosition = null;
});

elements.zoneChannels.addEventListener('dragend', () => {
  state.draggedPosition = null;
  elements.zoneChannels.querySelectorAll('.dragging, .drag-over').forEach(item => item.classList.remove('dragging', 'drag-over'));
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

elements.newZone.addEventListener('click', createZone);
elements.deleteZone.addEventListener('click', deleteSelectedZone);
elements.resetChanges.addEventListener('click', resetChanges);

elements.exportCsv.addEventListener('click', () => {
  if (!state.zones.length) return;
  downloadBlob(zonesToCsv(state.zones, state.channelMap), 'text/csv;charset=utf-8', `${outputBaseName()}-zones.csv`);
});

elements.downloadTw.addEventListener('click', () => {
  try {
    if (!state.payload) return;
    validateZoneSlots();
    const editedPayload = applyZoneChanges(state.payload, state.zones, state.originalZones);
    const tw = buildRawTw(editedPayload);
    downloadBlob(new Blob([tw], { type: 'application/octet-stream' }), 'application/octet-stream', `${outputBaseName()}-hd1-programmer.tw`);
    showMessage('TW-Datei erzeugt. Bitte jetzt in der Ailunce CPS öffnen und die Zonen prüfen, bevor du sie ins Funkgerät schreibst.', 'success');
  } catch (error) {
    console.error(error);
    showMessage(error instanceof TwError ? error.message : `TW-Datei konnte nicht erzeugt werden: ${error.message}`, 'error');
  }
});
