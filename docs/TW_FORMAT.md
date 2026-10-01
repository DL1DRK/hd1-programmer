# Ailunce HD1 `.tw` format notes

These notes document the parts of the **Ailunce HD1(GPS) CPS v3.05** codeplug format that have been established by controlled byte-level tests. They are not vendor documentation.

## Container / Eliminator representation

A normal CPS `.tw` file contains an encoded payload followed by one byte that specifies how many decode passes the CPS applies.

After all passes have been decoded, the raw payload:

- starts with ASCII `SLQFEO`
- is `765697` bytes long for the tested HD1(GPS) CPS v3.05 format

The CPS also accepts the raw payload directly when a trailing byte `0x00` is appended. The HD1 Programmer therefore currently writes **RAW `.tw` files** rather than re-implementing the CPS encoder.

This behavior has been validated by opening both an unchanged decoded codeplug and structurally changed decoded codeplugs in the original CPS. A generated RAW codeplug has also been written successfully to an HD1 via the original CPS.

## Zone table

For the tested raw image:

| Field | Value |
| --- | ---: |
| Zone table offset | `708688` (`0xAD050`) |
| Zone record size | `145` bytes |
| Maximum channel references per zone | `64` |
| Zone name field | `16` bytes |
| Slots scanned by HD1 Programmer | `64` |

Each occupied zone record is structured as:

```text
+0x00  1 byte       channel count
+0x01  128 bytes    64 × uint16 little-endian channel references
+0x81  16 bytes     zone name, NUL padded
```

Channel references are **zero-based**. A stored value `0x0042` therefore refers to CPS channel number `67`.

Unused channel-reference slots contain `FF FF` in CPS-generated records. Completely unused zone records in the tested codeplug are filled with `FF` for all 145 bytes.

### Controlled diff confirmation

Removing the last channel from a 43-channel zone changed exactly the expected decoded bytes:

- count `0x2B` → `0x2A`
- final reference `42 00` → `FF FF`

No other bytes in the decoded raw payload changed.

## Zone allocation safety in v0.2.0

The writer distinguishes three cases:

1. **Existing zone:** only its known 145-byte record is rewritten.
2. **Deleted zone:** only a record that was recognized as an occupied zone in the originally loaded codeplug is cleared to `FF`.
3. **New zone:** a new record is written only when that slot was completely `FF` in the original raw image, or when the slot belonged to an existing zone that was deleted during the current editing session.

A slot that contains non-`FF` data but was not recognized as an existing zone is never overwritten by the new-zone logic.

The tool preserves every byte outside records explicitly affected by these rules.

> Creating and deleting zones remains a reverse-engineered feature and should be validated in the original CPS before writing to the radio.

## Test procedure for generated codeplugs

1. Keep the original `.tw` as a backup.
2. Generate a new `.tw` with HD1 Programmer.
3. Open the generated file in Ailunce HD1(GPS) CPS v3.05.
4. Check zone names, membership and order.
5. For a newly created or deleted zone, verify the complete zone list in the CPS.
6. Only then consider writing the codeplug to the radio.

Never use personal codeplugs or vendor executables as public repository fixtures without explicitly sanitizing/licensing them first.
