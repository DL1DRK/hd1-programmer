# Ailunce HD1 `.tw` format notes

These notes document the parts of the **Ailunce HD1(GPS) CPS v3.05** codeplug format that have been established by controlled byte-level tests. They are not vendor documentation.

## Container / Eliminator representation

A normal CPS `.tw` file contains an encoded payload followed by one byte that specifies how many decode passes the CPS applies.

After all passes have been decoded, the raw payload:

- starts with ASCII `SLQFEO`
- is `765697` bytes long for the tested HD1(GPS) CPS v3.05 format

The CPS also accepts the raw payload directly when a trailing byte `0x00` is appended. The HD1 Programmer therefore currently writes **RAW `.tw` files** rather than re-implementing the CPS encoder.

This behavior has been validated by opening both an unchanged decoded codeplug and a structurally changed decoded codeplug in the original CPS without an `Incorrect File Type` error.

## Zone table

For the tested raw image:

| Field | Value |
| --- | ---: |
| Zone table offset | `708688` (`0xAD050`) |
| Zone record size | `145` bytes |
| Maximum channel references per zone | `64` |
| Zone name field | `16` bytes |

Each occupied zone record is structured as:

```text
+0x00  1 byte       channel count
+0x01  128 bytes    64 × uint16 little-endian channel references
+0x81  16 bytes     zone name, NUL padded
```

Channel references are **zero-based**. A stored value `0x0042` therefore refers to CPS channel number `67`.

Unused channel-reference slots contain `FF FF` in CPS-generated records.

### Controlled diff confirmation

Removing the last channel from a 43-channel zone changed exactly the expected decoded bytes:

- count `0x2B` → `0x2A`
- final reference `42 00` → `FF FF`

No other bytes in the decoded raw payload changed.

## Current safety boundary

Version 0.1.0 only modifies **already occupied zone slots** discovered in the source codeplug. Creation/deletion of zone slots is intentionally deferred until the complete zone-slot allocation behavior has been validated.

The tool preserves every byte outside the zone records it edits.

## Test procedure for generated codeplugs

1. Keep the original `.tw` as a backup.
2. Generate a new `.tw` with HD1 Programmer.
3. Open the generated file in Ailunce HD1(GPS) CPS v3.05.
4. Check zone names, membership and order.
5. Only then consider writing the codeplug to the radio.

Never use personal codeplugs or vendor executables as public repository fixtures without explicitly sanitizing/licensing them first.
