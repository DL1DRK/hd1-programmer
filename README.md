# HD1 Programmer

Web-based codeplug editor for the **Ailunce HD1**.

> **Status:** experimental / reverse-engineered. The project is not affiliated with or endorsed by Ailunce.

The application is intended to run at **https://ailunce.dl1drk.de/** and processes codeplug files locally in the browser. Uploaded `.tw` files and channel CSV files are not sent to a server by the application.

## Current scope

Version `0.2.0` focuses on the zone table of codeplugs created by **Ailunce HD1(GPS) CPS v3.05**:

- open compressed or raw `.tw` files
- decode the CPS `Eliminator` representation
- display and rename zones
- create zones in verified empty zone slots
- delete zones while leaving unrelated raw codeplug areas untouched
- optionally load an HD1 channel-list CSV to resolve channel numbers to aliases, frequencies and channel type
- add and remove channels inside zones
- reorder channels with buttons or drag-and-drop
- show a change summary against the originally loaded codeplug
- reset all zone edits back to the loaded state
- import and export zone assignments as CSV
- generate a CPS-readable raw `.tw` file

The zone writer only modifies 145-byte zone records that were already occupied, explicitly deleted, or verified as all-`FF` empty slots in the loaded raw image.

Before writing a generated codeplug to a radio, always open and verify it in the original Ailunce CPS and keep a known-good backup.

## Repository layout

- `app/` – browser application
- `installer/` – web installer and updater for shared hosting
- `docs/` – reverse-engineering and installation notes
- `tests/` – format and writer tests
- `.github/workflows/` – CI and release packaging

## Installation target

The reference deployment is ordinary PHP-capable shared hosting. The application itself is static HTML/CSS/JavaScript; PHP is only used for installation and updates.

## License

This project is licensed under **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

Copyright © 2026 DL1DRK and contributors.
