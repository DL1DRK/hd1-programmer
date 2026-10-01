# Development

HD1 Programmer deliberately has no frontend build step and no runtime JavaScript dependencies. The deployed editor is plain HTML/CSS/ES modules.

## Local development

Serve `app/` through a local web server, for example:

```bash
python -m http.server 8080 --directory app
```

Then open `http://localhost:8080/`.

The browser code is split into:

- `js/hd1tw.js` – TW decode/RAW writer and zone-record handling
- `js/channels.js` – HD1 channel-list CSV parser
- `js/zones.js` – zone CSV import helpers
- `js/app.js` – user interface/state

## Tests

The repository contains dependency-free Node tests for the RAW TW/zone engine:

```bash
npm test
```

CI also performs a PHP syntax check of the installer and updater.

## Release process

1. update `VERSION` and the version shown in `app/index.html`
2. commit and push to `main`
3. ensure CI is green
4. create and push a matching tag, for example `v0.1.0`
5. `.github/workflows/release.yml` builds the deployment ZIP, `manifest.json`, `SHA256SUMS`, and the standalone `install.php`, then creates a GitHub release

The installer/updater consumes **release assets**, never the `main` branch.

## Reverse-engineering policy

Only document behavior established from controlled tests or static analysis. Keep vendor binaries, personal codeplugs, DMR contact databases and other non-project data out of the repository.

Generated codeplug support should remain conservative: read first, preserve unknown bytes, and only write structures whose layout has been validated.
