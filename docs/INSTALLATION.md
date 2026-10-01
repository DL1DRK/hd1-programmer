# Installation on shared hosting

Reference deployment: **https://ailunce.dl1drk.de/** on ordinary PHP-capable shared hosting.

## Requirements

- HTTPS
- PHP 8.1 or newer
- PHP extensions/functions: `curl` (preferred) or URL-aware `file_get_contents`, `ZipArchive`, `hash_file`
- write access for the web-server/PHP user in the target document root
- outbound HTTPS access to `api.github.com` and GitHub release downloads

The actual editor is static HTML/CSS/JavaScript. PHP is used only by the installer/updater.

## Fresh installation

1. Point the subdomain/document root to an empty directory.
2. Download the `install.php` asset from the desired GitHub release.
3. Upload only `install.php` to the document root.
4. Open `https://ailunce.dl1drk.de/install.php`.
5. The installer checks PHP/Zip/write access, fetches the latest stable release manifest and package, verifies the SHA-256 hash and extracts the package.
6. The installer creates a local update token in `config/update.php` and displays it once. Store it safely.
7. Delete `install.php` from the webspace after successful installation.

## Updates

Open `/admin/update.php`, enter the local update token and install the offered release. The updater:

1. checks GitHub's latest stable release
2. downloads `manifest.json`
3. downloads the named application package
4. verifies SHA-256
5. creates a timestamped backup of the currently managed application files
6. replaces the application files
7. keeps `config/`, `data/` and `backup/`

## Recovery

Backups are intentionally stored outside the application package in `backup/`. If an update fails after backup creation, restore the most recent backup using the hosting file manager/FTP/SSH.

## Privacy

The editor does **not** upload codeplugs to the hosting server. `.tw` and `.csv` files are read with browser APIs and processed in JavaScript on the user's device.
