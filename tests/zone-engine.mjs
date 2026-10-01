import assert from 'node:assert/strict';
import {
  RAW_MAGIC,
  RAW_PAYLOAD_SIZE,
  ZONE_CHANNEL_LIMIT,
  writeZone,
  readZones,
  buildRawTw,
  decodeTw,
  isZoneSlotEmpty,
  findFreeZoneSlot,
  clearZone,
  applyZoneChanges
} from '../app/js/hd1tw.js';

const payload = new Uint8Array(RAW_PAYLOAD_SIZE);
payload.fill(0xff);
for (let i = 0; i < RAW_MAGIC.length; i++) payload[i] = RAW_MAGIC.charCodeAt(i);

const sourceZone = {
  index: 0,
  name: 'TEST',
  channels: [1, 25, 67, 131]
};

writeZone(payload, sourceZone);
const zones = readZones(payload);
assert.equal(zones.length, 1);
assert.equal(zones[0].name, 'TEST');
assert.deepEqual(zones[0].channels, [1, 25, 67, 131]);
assert.equal(isZoneSlotEmpty(payload, 0), false);
assert.equal(isZoneSlotEmpty(payload, 1), true);
assert.equal(findFreeZoneSlot(payload, [0]), 1);

// RAW .tw: payload + trailing 0 decode-pass byte.
const rawTw = buildRawTw(payload);
assert.equal(rawTw.length, RAW_PAYLOAD_SIZE + 1);
assert.equal(rawTw.at(-1), 0);

const decoded = decodeTw(rawTw.buffer);
assert.equal(decoded.passes, 0);
assert.equal(decoded.zones.length, 1);
assert.deepEqual(decoded.zones[0].channels, sourceZone.channels);

// Synthetic one-pass Eliminator stream.
// Control byte 0x20 emits literal 'S' and then special byte 'L', followed by
// the remainder of the literal stream. The result must equal the RAW payload.
const literalStream = new Uint8Array(RAW_PAYLOAD_SIZE - 1);
literalStream[0] = payload[0];
literalStream.set(payload.slice(2), 1);

const encodedPass = new Uint8Array(8 + literalStream.length);
encodedPass.set([0x00, 0x00, 0x05], 0); // literalStart = 5 + 3 = 8
encodedPass[3] = payload[1];            // special byte = 'L'
encodedPass.set([0x00, 0x00, 0x01], 4); // one special byte to emit
encodedPass[7] = 0x20;                  // literal, special
encodedPass.set(literalStream, 8);

const compressedTw = new Uint8Array(encodedPass.length + 1);
compressedTw.set(encodedPass, 0);
compressedTw[compressedTw.length - 1] = 1;

const decodedCompressed = decodeTw(compressedTw.buffer);
assert.equal(decodedCompressed.passes, 1);
assert.deepEqual(decodedCompressed.payload, payload);

const maxZone = {
  index: 1,
  name: 'MAX64',
  channels: Array.from({ length: ZONE_CHANNEL_LIMIT }, (_, i) => i + 1)
};
writeZone(payload, maxZone);
const afterMax = readZones(payload);
assert.equal(afterMax.find(z => z.index === 1).channels.length, 64);

// Deleting an existing zone clears only its 145-byte record. Adding a new
// zone writes into a previously empty slot and leaves the rest of the RAW
// image untouched.
const originalZones = readZones(payload);
const editedZones = [
  { ...sourceZone, name: 'RENAMED', channels: [1, 25, 131] },
  { index: 2, name: 'NEWZONE', channels: [50, 51] }
];
const changed = applyZoneChanges(payload, editedZones, originalZones);
const changedZones = readZones(changed);
assert.deepEqual(changedZones.map(z => z.index), [0, 2]);
assert.equal(changedZones[0].name, 'RENAMED');
assert.deepEqual(changedZones[0].channels, [1, 25, 131]);
assert.equal(isZoneSlotEmpty(changed, 1), true);
assert.deepEqual(changedZones[1].channels, [50, 51]);

const cleared = changed.slice();
clearZone(cleared, 2);
assert.equal(isZoneSlotEmpty(cleared, 2), true);

console.log('HD1 zone engine tests passed.');
