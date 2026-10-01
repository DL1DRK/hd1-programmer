export const RAW_MAGIC = 'SLQFEO';
export const RAW_PAYLOAD_SIZE = 765697;
export const ZONE_TABLE_OFFSET = 708688; // 0xAD050
export const ZONE_RECORD_SIZE = 145;
export const ZONE_CHANNEL_LIMIT = 64;
export const ZONE_NAME_SIZE = 16;
export const ZONE_SCAN_SLOTS = 64;

export class TwError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TwError';
  }
}

function readU24BE(data, offset) {
  return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

function ascii(data) {
  return String.fromCharCode(...data);
}

function decodePass(data) {
  if (data.length < 7) throw new TwError('Komprimierter Durchlauf ist zu kurz.');

  const literalStart = readU24BE(data, 0) + 3;
  const special = data[3];
  const specialTarget = readU24BE(data, 4);

  if (literalStart > data.length) {
    throw new TwError('Ungültiger Literal-Offset im komprimierten TW-Durchlauf.');
  }

  let codePos = 7;
  let literalPos = literalStart;
  let specialSeen = 0;
  const out = [];

  while (specialSeen < specialTarget) {
    if (codePos >= literalStart) {
      throw new TwError('Steuerdaten des TW-Durchlaufs enden unerwartet.');
    }

    const code = data[codePos++];

    if (code & 0x80) {
      const count = (code & 0x7f) + 7;
      if (literalPos + count > data.length) {
        throw new TwError('Literal-Lauf überschreitet die Dateigrenze.');
      }
      for (let i = 0; i < count; i++) out.push(data[literalPos++]);

      // Verhalten der in der CPS rekonstruierten Eliminator-Decode-Routine.
      if (count !== 0x86) {
        out.push(special);
        specialSeen++;
      }
    } else {
      for (let bit = 6; bit >= 0 && specialSeen < specialTarget; bit--) {
        if (code & (1 << bit)) {
          out.push(special);
          specialSeen++;
        } else {
          if (literalPos >= data.length) {
            throw new TwError('Literal-Daten enden unerwartet.');
          }
          out.push(data[literalPos++]);
        }
      }
    }
  }

  while (literalPos < data.length) out.push(data[literalPos++]);
  return Uint8Array.from(out);
}

export function decodeTw(arrayBuffer) {
  const file = new Uint8Array(arrayBuffer);
  if (!file.length) throw new TwError('Die Datei ist leer.');

  const passes = file[file.length - 1];
  let payload = file.slice(0, -1);

  for (let i = 0; i < passes; i++) payload = decodePass(payload);

  if (ascii(payload.slice(0, RAW_MAGIC.length)) !== RAW_MAGIC) {
    throw new TwError('Die dekodierten Daten beginnen nicht mit SLQFEO. Falscher Dateityp oder nicht unterstützte CPS-Version.');
  }

  if (payload.length !== RAW_PAYLOAD_SIZE) {
    throw new TwError(`Unerwartete RAW-Größe ${payload.length} Byte; erwartet werden ${RAW_PAYLOAD_SIZE} Byte für HD1(GPS) CPS v3.05.`);
  }

  return {
    payload: payload.slice(),
    passes,
    zones: readZones(payload)
  };
}

function zoneOffset(index) {
  return ZONE_TABLE_OFFSET + index * ZONE_RECORD_SIZE;
}

function isAllFF(record) {
  for (const b of record) if (b !== 0xff) return false;
  return true;
}

function decodeZoneName(raw) {
  const bytes = [];
  for (const b of raw) {
    if (b === 0x00 || b === 0xff) break;
    bytes.push(b);
  }
  return String.fromCharCode(...bytes);
}

function looksLikeZoneName(name) {
  if (!name.length) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export function readZoneRecord(payload, index) {
  const offset = zoneOffset(index);
  const record = payload.slice(offset, offset + ZONE_RECORD_SIZE);
  if (record.length !== ZONE_RECORD_SIZE) return null;
  if (isAllFF(record)) return null;

  const count = record[0];
  if (count > ZONE_CHANNEL_LIMIT) return null;

  const name = decodeZoneName(record.slice(129, 145));
  if (!looksLikeZoneName(name)) return null;

  const channels = [];
  for (let i = 0; i < count; i++) {
    const p = 1 + i * 2;
    const ref = record[p] | (record[p + 1] << 8);
    if (ref === 0xffff) break;
    channels.push(ref + 1); // CPS numbers are 1-based; stored refs are zero-based.
  }

  return { index, name, channels };
}

export function readZones(payload) {
  const zones = [];
  for (let i = 0; i < ZONE_SCAN_SLOTS; i++) {
    const zone = readZoneRecord(payload, i);
    if (zone) zones.push(zone);
  }
  return zones;
}

function encodeAsciiName(name) {
  if (!name.length) throw new TwError('Zonenname darf nicht leer sein.');
  if (name.length > ZONE_NAME_SIZE) throw new TwError(`Zonenname darf maximal ${ZONE_NAME_SIZE} ASCII-Zeichen lang sein.`);

  const bytes = [];
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      throw new TwError('Version 0.1.0 erlaubt im Zonennamen nur druckbare ASCII-Zeichen.');
    }
    bytes.push(code);
  }
  return bytes;
}

export function writeZone(payload, zone) {
  if (!Number.isInteger(zone.index) || zone.index < 0 || zone.index >= ZONE_SCAN_SLOTS) {
    throw new TwError('Ungültiger Zonenslot.');
  }
  if (!Array.isArray(zone.channels) || zone.channels.length > ZONE_CHANNEL_LIMIT) {
    throw new TwError(`Eine Zone darf höchstens ${ZONE_CHANNEL_LIMIT} Kanäle enthalten.`);
  }

  const nameBytes = encodeAsciiName(zone.name.trim());
  const seen = new Set();
  for (const channel of zone.channels) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 65535) {
      throw new TwError(`Ungültige Kanalnummer ${channel}.`);
    }
    if (seen.has(channel)) throw new TwError(`Kanal ${channel} ist in Zone "${zone.name}" doppelt enthalten.`);
    seen.add(channel);
  }

  const record = new Uint8Array(ZONE_RECORD_SIZE);
  record.fill(0xff);
  record[0] = zone.channels.length;

  zone.channels.forEach((channel, i) => {
    const ref = channel - 1;
    const p = 1 + i * 2;
    record[p] = ref & 0xff;
    record[p + 1] = (ref >> 8) & 0xff;
  });

  // Belegte Zonennamen sind in der CPS NUL-aufgefüllt.
  record.fill(0x00, 129, 145);
  record.set(nameBytes, 129);

  payload.set(record, zoneOffset(zone.index));
}

export function applyZones(payload, zones) {
  const result = payload.slice();
  for (const zone of zones) writeZone(result, zone);
  return result;
}

export function buildRawTw(payload) {
  if (payload.length !== RAW_PAYLOAD_SIZE) throw new TwError('Unerwartete RAW-Größe; Ausgabe abgebrochen.');
  if (ascii(payload.slice(0, RAW_MAGIC.length)) !== RAW_MAGIC) throw new TwError('SLQFEO-Kennung fehlt; Ausgabe abgebrochen.');

  const out = new Uint8Array(payload.length + 1);
  out.set(payload, 0);
  out[out.length - 1] = 0; // CPS: keine Eliminator-Decode-Durchläufe nötig.
  return out;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function zonesToCsv(zones, channelMap = new Map()) {
  const rows = [['ZoneIndex', 'ZoneName', 'ChannelNumber', 'ChannelAlias']];
  for (const zone of zones) {
    if (!zone.channels.length) rows.push([zone.index, zone.name, '', '']);
    for (const channel of zone.channels) {
      rows.push([zone.index, zone.name, channel, channelMap.get(channel)?.alias ?? '']);
    }
  }
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
