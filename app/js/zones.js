import { parseCsv, CsvError } from './channels.js';

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function findColumn(headers, names) {
  const h = headers.map(normalize);
  for (const name of names) {
    const idx = h.indexOf(normalize(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseZoneCsv(text, allowedIndices = null) {
  const rows = parseCsv(text);
  if (!rows.length) throw new CsvError('Zonen-CSV ist leer.');

  const headers = rows[0];
  const indexCol = findColumn(headers, ['ZoneIndex']);
  const nameCol = findColumn(headers, ['ZoneName']);
  const channelCol = findColumn(headers, ['ChannelNumber']);

  if (indexCol < 0 || nameCol < 0 || channelCol < 0) {
    throw new CsvError('Zonen-CSV benötigt die Spalten ZoneIndex, ZoneName und ChannelNumber.');
  }

  const grouped = new Map();
  for (const row of rows.slice(1)) {
    if (!row.some(v => String(v ?? '').trim())) continue;

    const index = Number.parseInt((row[indexCol] ?? '').trim(), 10);
    const name = (row[nameCol] ?? '').trim();
    const channelText = (row[channelCol] ?? '').trim();

    if (!Number.isInteger(index) || index < 0) throw new CsvError(`Ungültiger ZoneIndex: ${row[indexCol] ?? ''}`);
    if (allowedIndices && !allowedIndices.has(index)) {
      throw new CsvError(`ZoneIndex ${index} existiert im geladenen Codeplug nicht. Version 0.1.0 legt keine neuen Zonen an.`);
    }
    if (!name) throw new CsvError(`Zone ${index} hat keinen Namen.`);

    if (!grouped.has(index)) grouped.set(index, { index, name, channels: [] });
    const zone = grouped.get(index);
    if (zone.name !== name) throw new CsvError(`ZoneIndex ${index} wird mit mehreren Namen verwendet.`);

    if (channelText) {
      const channel = Number.parseInt(channelText, 10);
      if (!Number.isInteger(channel) || channel < 1 || channel > 65535) {
        throw new CsvError(`Ungültige Kanalnummer "${channelText}" in Zone ${index}.`);
      }
      zone.channels.push(channel);
    }
  }

  for (const zone of grouped.values()) {
    if (zone.channels.length > 64) throw new CsvError(`Zone "${zone.name}" enthält mehr als 64 Kanäle.`);
    if (new Set(zone.channels).size !== zone.channels.length) throw new CsvError(`Zone "${zone.name}" enthält doppelte Kanäle.`);
  }

  return [...grouped.values()].sort((a, b) => a.index - b.index);
}
