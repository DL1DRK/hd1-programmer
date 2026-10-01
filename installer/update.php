<?php
declare(strict_types=1);

const HD1_REPOSITORY = 'DL1DRK/hd1-programmer';
const HD1_RELEASE_API = 'https://api.github.com/repos/' . HD1_REPOSITORY . '/releases/latest';
const HD1_USER_AGENT = 'HD1-Programmer-Updater/0.1';
const HD1_MANAGED_PATHS = ['index.html', 'css', 'js', 'assets', 'admin', 'VERSION'];

$root = dirname(__DIR__);

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function http_get(string $url): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_USERAGENT => HD1_USER_AGENT,
            CURLOPT_HTTPHEADER => ['Accept: application/vnd.github+json'],
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false || $status < 200 || $status >= 300) {
            throw new RuntimeException("HTTP-Fehler bei $url (Status $status): $error");
        }
        return $body;
    }

    if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOL)) {
        throw new RuntimeException('Weder cURL noch allow_url_fopen stehen zur Verfügung.');
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "User-Agent: " . HD1_USER_AGENT . "\r\nAccept: application/vnd.github+json\r\n",
            'timeout' => 120,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    if ($body === false) throw new RuntimeException("Download von $url fehlgeschlagen.");
    return $body;
}

function latest_release(): array
{
    $release = json_decode(http_get(HD1_RELEASE_API), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($release) || empty($release['assets'])) throw new RuntimeException('Das aktuelle GitHub-Release enthält keine Assets.');
    return $release;
}

function release_asset_url(array $release, string $name): string
{
    foreach ($release['assets'] as $asset) {
        if (($asset['name'] ?? '') === $name && !empty($asset['browser_download_url'])) return (string)$asset['browser_download_url'];
    }
    throw new RuntimeException("Release-Asset '$name' wurde nicht gefunden.");
}

function manifest_from_release(array $release): array
{
    $manifest = json_decode(http_get(release_asset_url($release, 'manifest.json')), true, 512, JSON_THROW_ON_ERROR);
    foreach (['version', 'package', 'sha256', 'min_php'] as $key) {
        if (!isset($manifest[$key]) || !is_string($manifest[$key]) || $manifest[$key] === '') {
            throw new RuntimeException("Ungültiges Release-Manifest: '$key' fehlt.");
        }
    }
    if (!preg_match('/^[a-f0-9]{64}$/i', $manifest['sha256'])) throw new RuntimeException('Ungültiger SHA-256-Wert im Release-Manifest.');
    return $manifest;
}

function recursive_remove(string $path): void
{
    if (!file_exists($path)) return;
    if (is_file($path) || is_link($path)) { if (!@unlink($path)) throw new RuntimeException("Datei konnte nicht entfernt werden: $path"); return; }
    $items = scandir($path);
    if ($items === false) throw new RuntimeException("Verzeichnis konnte nicht gelesen werden: $path");
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        recursive_remove($path . DIRECTORY_SEPARATOR . $item);
    }
    if (!@rmdir($path)) throw new RuntimeException("Verzeichnis konnte nicht entfernt werden: $path");
}

function copy_tree(string $source, string $destination): void
{
    if (is_file($source)) {
        $parent = dirname($destination);
        if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) throw new RuntimeException("Verzeichnis konnte nicht angelegt werden: $parent");
        if (!copy($source, $destination)) throw new RuntimeException("Datei konnte nicht kopiert werden: $source");
        return;
    }
    if (!is_dir($source)) return;
    if (!is_dir($destination) && !mkdir($destination, 0755, true) && !is_dir($destination)) throw new RuntimeException("Verzeichnis konnte nicht angelegt werden: $destination");
    $items = scandir($source);
    if ($items === false) throw new RuntimeException("Verzeichnis konnte nicht gelesen werden: $source");
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        copy_tree($source . DIRECTORY_SEPARATOR . $item, $destination . DIRECTORY_SEPARATOR . $item);
    }
}

function validate_zip_entry(string $name): void
{
    $name = str_replace('\\', '/', $name);
    if ($name === '' || str_contains($name, "\0") || str_starts_with($name, '/') || preg_match('/^[A-Za-z]:\//', $name)) throw new RuntimeException("Unsicherer ZIP-Pfad: $name");
    foreach (explode('/', $name) as $part) if ($part === '..') throw new RuntimeException("Unsicherer ZIP-Pfad: $name");
}

function safe_extract(string $zipFile, string $target): void
{
    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) throw new RuntimeException('Release-ZIP konnte nicht geöffnet werden.');
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name !== false) validate_zip_entry($name);
    }
    if (!$zip->extractTo($target)) { $zip->close(); throw new RuntimeException('Release-ZIP konnte nicht entpackt werden.'); }
    $zip->close();
}

function managed_backup(string $root, string $backup): void
{
    if (!is_dir($backup) && !mkdir($backup, 0750, true) && !is_dir($backup)) throw new RuntimeException('Backup-Verzeichnis konnte nicht angelegt werden.');
    foreach (HD1_MANAGED_PATHS as $path) {
        $source = $root . DIRECTORY_SEPARATOR . $path;
        if (file_exists($source)) copy_tree($source, $backup . DIRECTORY_SEPARATOR . $path);
    }
}

function remove_managed(string $root): void
{
    foreach (HD1_MANAGED_PATHS as $path) {
        $target = $root . DIRECTORY_SEPARATOR . $path;
        if (file_exists($target)) recursive_remove($target);
    }
}

function restore_backup(string $root, string $backup): void
{
    remove_managed($root);
    foreach (HD1_MANAGED_PATHS as $path) {
        $source = $backup . DIRECTORY_SEPARATOR . $path;
        if (file_exists($source)) copy_tree($source, $root . DIRECTORY_SEPARATOR . $path);
    }
}

$configFile = $root . '/config/update.php';
$config = is_file($configFile) ? require $configFile : [];
$storedToken = is_array($config) ? (string)($config['token'] ?? '') : '';
$currentVersion = is_file($root . '/VERSION') ? trim((string)file_get_contents($root . '/VERSION')) : 'unbekannt';

$error = null;
$success = null;
$manifest = null;
$release = null;

try {
    $release = latest_release();
    $manifest = manifest_from_release($release);
} catch (Throwable $ex) {
    $error = 'Update-Prüfung fehlgeschlagen: ' . $ex->getMessage();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'update') {
    try {
        if ($storedToken === '') throw new RuntimeException('Kein Update-Schlüssel konfiguriert. Installation reparieren oder config/update.php prüfen.');
        $providedToken = (string)($_POST['token'] ?? '');
        if (!hash_equals($storedToken, $providedToken)) throw new RuntimeException('Update-Schlüssel ist falsch.');
        if (!$manifest || !$release) throw new RuntimeException('Kein gültiges Release-Manifest verfügbar.');
        if (version_compare(PHP_VERSION, $manifest['min_php'], '<')) throw new RuntimeException("Release {$manifest['version']} benötigt mindestens PHP {$manifest['min_php']}.");
        if ($currentVersion !== 'unbekannt' && version_compare($manifest['version'], $currentVersion, '<=')) throw new RuntimeException('Es ist kein neueres Stable-Release verfügbar.');
        if (!is_writable($root)) throw new RuntimeException('Webverzeichnis ist nicht beschreibbar.');
        if (!class_exists('ZipArchive')) throw new RuntimeException('ZipArchive fehlt.');

        $work = $root . '/.hd1-update-' . bin2hex(random_bytes(6));
        $stage = $work . '/stage';
        if (!mkdir($stage, 0755, true) && !is_dir($stage)) throw new RuntimeException('Temporäres Update-Verzeichnis konnte nicht angelegt werden.');

        $backup = $root . '/backup/' . date('Ymd-His') . '-' . preg_replace('/[^0-9A-Za-z._-]/', '_', $currentVersion);
        $backupReady = false;

        try {
            $zipFile = $work . '/package.zip';
            $packageUrl = release_asset_url($release, $manifest['package']);
            if (file_put_contents($zipFile, http_get($packageUrl), LOCK_EX) === false) throw new RuntimeException('Release-Paket konnte nicht gespeichert werden.');
            $actualHash = hash_file('sha256', $zipFile);
            if (!hash_equals(strtolower($manifest['sha256']), strtolower((string)$actualHash))) throw new RuntimeException('SHA-256-Prüfung des Release-Pakets fehlgeschlagen.');

            safe_extract($zipFile, $stage);
            if (!is_file($stage . '/index.html') || !is_file($stage . '/VERSION')) throw new RuntimeException('Release-Paket enthält nicht die erwartete Anwendung.');

            managed_backup($root, $backup);
            $backupReady = true;
            remove_managed($root);
            copy_tree($stage, $root);
            $newVersion = trim((string)file_get_contents($root . '/VERSION'));
            if ($newVersion !== $manifest['version']) throw new RuntimeException('Installierte VERSION stimmt nicht mit dem Release-Manifest überein.');

            $currentVersion = $newVersion;
            $success = "Update auf HD1 Programmer {$newVersion} erfolgreich. Backup: " . basename($backup);
        } catch (Throwable $updateError) {
            if ($backupReady) {
                try { restore_backup($root, $backup); } catch (Throwable $rollbackError) {
                    throw new RuntimeException($updateError->getMessage() . ' Zusätzlich ist das automatische Rollback fehlgeschlagen: ' . $rollbackError->getMessage());
                }
            }
            throw $updateError;
        } finally {
            if (is_dir($work)) recursive_remove($work);
        }
    } catch (Throwable $ex) {
        $error = $ex->getMessage();
    }
}

$updateAvailable = $manifest && $currentVersion !== 'unbekannt' && version_compare($manifest['version'], $currentVersion, '>');
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HD1 Programmer – Update</title>
<style>
body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 18px;background:#f4f6f8;color:#18212b}main{background:white;border:1px solid #d8dee5;border-radius:14px;padding:24px;box-shadow:0 8px 24px #14223012}h1{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{padding:12px 14px;border:1px solid #d8dee5;border-radius:9px;margin:14px 0}.error{border-color:#a82d2d}.success{border-color:#3c8d5c}.good{color:#24723f}input{width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd3dc;border-radius:7px;margin:6px 0 10px}button{background:#1f5d8f;color:white;border:0;border-radius:8px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}code{background:#eef2f5;padding:2px 5px;border-radius:5px}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style>
</head>
<body><main>
<h1>HD1 Programmer – Update</h1>
<div class="grid">
<div class="box"><small>Installiert</small><br><strong><?= e($currentVersion) ?></strong></div>
<div class="box"><small>Aktuelles Stable-Release</small><br><strong><?= e($manifest['version'] ?? 'nicht ermittelbar') ?></strong></div>
</div>

<?php if ($error): ?><div class="box error"><strong>Hinweis:</strong> <?= e($error) ?></div><?php endif; ?>
<?php if ($success): ?><div class="box success"><strong><?= e($success) ?></strong></div><?php endif; ?>

<?php if ($storedToken === ''): ?>
<div class="box error">Es wurde kein Update-Schlüssel gefunden. Erwartet wird <code>config/update.php</code>.</div>
<?php elseif ($updateAvailable): ?>
<p class="good"><strong>Eine neue Version ist verfügbar.</strong></p>
<form method="post">
<input type="hidden" name="action" value="update">
<label>Update-Schlüssel
<input name="token" type="password" required autocomplete="current-password"></label>
<button type="submit">Update installieren</button>
</form>
<?php elseif ($manifest && !$success): ?>
<p>Die Installation ist auf dem aktuellen Stable-Stand.</p>
<?php endif; ?>

<p style="margin-top:24px"><a href="../">Zur Anwendung</a></p>
<p style="color:#66717e;font-size:.9rem">Der Update-Schlüssel steht serverseitig in <code>config/update.php</code>. Er wird nicht an GitHub übertragen.</p>
</main></body></html>
