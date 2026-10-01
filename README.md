# HD1 Programmer

Web-based codeplug editor for the **Ailunce HD1**.

> **Status:** experimental / reverse-engineered. The project is not affiliated with or endorsed by Ailunce.

The application is intended to run at **https://ailunce.dl1drk.de/** and processes codeplug files locally in the browser. Uploaded `.tw` files and channel CSV files are not sent to a server by the application.

## Current scope

Version `0.1.0` focuses on the zone table of codeplugs created by **Ailunce HD1(GPS) CPS v3.05**:

- open compressed or raw `.tw` files
- decode the CPS `Eliminator` representation
- display existing zones
- optionally load an HD1 channel-list CSV to resolve channel numbers to aliases
- rename existing zones
- add, remove and reorder channels inside existing zones
- export zone assignments as CSV
- generate a CPS-readable raw `.tw` file

Before writing a generated codeplug to a radio, always open and verify it in the original Ailunce CPS and keep a known-good backup.

## Repository layout

- `app/` – browser application
- `installer/` – web installer and updater for shared hosting
- `docs/` – reverse-engineering and installation notes
- `.github/workflows/` – release packaging

## Installation target

The reference deployment is ordinary PHP-capable shared hosting. The application itself is static HTML/CSS/JavaScript; PHP is only used for installation and updates.

## License

This project is licensed under **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

Copyright © 2026 DL1DRK and contributors.
