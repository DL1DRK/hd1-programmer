export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvError';
  }
}

function detectDelimiter(text) {
  const firstLine = text.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

export function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (quoted) throw new CsvError('CSV endet innerhalb eines Anführungszeichens.');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter(r => r.some(v => v !== ''));
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(normalizeHeader(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseChannelCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvError('Die Kanalliste enthält keine Datensätze.');

  const headers = rows[0];
  const noCol = findColumn(headers, ['No.', 'No', 'Nr.', 'Nr', 'Channel Number']);
  const aliasCol = findColumn(headers, ['Channel Alias', 'Alias', 'Channel Name']);
  const rxCol = findColumn(headers, ['Rx Frequency', 'RX Frequency']);
  const txCol = findColumn(headers, ['Tx Frequency', 'TX Frequency']);
  const typeCol = findColumn(headers, ['Channel Type', 'Type']);
  const slotCol = findColumn(headers, ['Slot', 'Time Slot']);
  const ccCol = findColumn(headers, ['Color Code', 'CC']);

  if (noCol < 0 || aliasCol < 0) {
    throw new CsvError('Kanallisten-CSV benötigt mindestens die Spalten "No." und "Channel Alias".');
  }

  const channels = new Map();
  for (const row of rows.slice(1)) {
    const number = Number.parseInt((row[noCol] ?? '').trim(), 10);
    if (!Number.isInteger(number) || number < 1) continue;

    const alias = (row[aliasCol] ?? '').trim() || `Kanal ${number}`;
    channels.set(number, {
      number,
      alias,
      rx: rxCol >= 0 ? (row[rxCol] ?? '').trim() : '',
      tx: txCol >= 0 ? (row[txCol] ?? '').trim() : '',
      type: typeCol >= 0 ? (row[typeCol] ?? '').trim() : '',
      slot: slotCol >= 0 ? (row[slotCol] ?? '').trim() : '',
      colorCode: ccCol >= 0 ? (row[ccCol] ?? '').trim() : ''
    });
  }

  if (!channels.size) throw new CsvError('Keine gültigen Kanäle in der CSV gefunden.');
  return channels;
}

export function channelLabel(number, channelMap) {
  return channelMap.get(number)?.alias ?? `Kanal ${number}`;
}

export function channelMeta(number, channelMap) {
  const channel = channelMap.get(number);
  if (!channel) return '';

  const parts = [];
  if (channel.type) parts.push(channel.type);
  if (channel.rx) parts.push(`RX ${channel.rx}`);
  if (channel.tx) parts.push(`TX ${channel.tx}`);
  if (channel.slot) parts.push(`TS ${channel.slot}`);
  if (channel.colorCode) parts.push(`CC ${channel.colorCode}`);
  return parts.join(' · ');
}
