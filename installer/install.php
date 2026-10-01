<?php
declare(strict_types=1);

const HD1_REPOSITORY = 'DL1DRK/hd1-programmer';
const HD1_RELEASE_API = 'https://api.github.com/repos/' . HD1_REPOSITORY . '/releases/latest';
const HD1_USER_AGENT = 'HD1-Programmer-Installer/0.1';

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
    if ($body === false) {
        throw new RuntimeException("Download von $url fehlgeschlagen.");
    }
    return $body;
}

function latest_release(): array
{
    $release = json_decode(http_get(HD1_RELEASE_API), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($release) || empty($release['assets'])) {
        throw new RuntimeException('Das aktuelle GitHub-Release enthält keine Assets.');
    }
    return $release;
}

function release_asset_url(array $release, string $name): string
{
    foreach ($release['assets'] as $asset) {
        if (($asset['name'] ?? '') === $name && !empty($asset['browser_download_url'])) {
            return (string)$asset['browser_download_url'];
        }
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
    if (!preg_match('/^[a-f0-9]{64}$/i', $manifest['sha256'])) {
        throw new RuntimeException('Ungültiger SHA-256-Wert im Release-Manifest.');
    }
    return $manifest;
}

function recursive_remove(string $path): void
{
    if (!file_exists($path)) {
        return;
    }
    if (is_file($path) || is_link($path)) {
        @unlink($path);
        return;
    }
    $items = scandir($path);
    if ($items !== false) {
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            recursive_remove($path . DIRECTORY_SEPARATOR . $item);
        }
    }
    @rmdir($path);
}

function validate_zip_entry(string $name): void
{
    $name = str_replace('\\', '/', $name);
    if ($name === '' || str_contains($name, "\0") || str_starts_with($name, '/') || preg_match('/^[A-Za-z]:\//', $name)) {
        throw new RuntimeException("Unsicherer ZIP-Pfad: $name");
    }
    foreach (explode('/', $name) as $part) {
        if ($part === '..') throw new RuntimeException("Unsicherer ZIP-Pfad: $name");
    }
}

function safe_extract(string $zipFile, string $target): void
{
    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) {
        throw new RuntimeException('Release-ZIP konnte nicht geöffnet werden.');
    }
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name === false) continue;
        validate_zip_entry($name);
    }
    if (!$zip->extractTo($target)) {
        $zip->close();
        throw new RuntimeException('Release-ZIP konnte nicht entpackt werden.');
    }
    $zip->close();
}

function copy_tree(string $source, string $destination): void
{
    if (!is_dir($source)) throw new RuntimeException("Quellverzeichnis fehlt: $source");
    if (!is_dir($destination) && !mkdir($destination, 0755, true) && !is_dir($destination)) {
        throw new RuntimeException("Zielverzeichnis konnte nicht angelegt werden: $destination");
    }
    $items = scandir($source);
    if ($items === false) throw new RuntimeException("Verzeichnis konnte nicht gelesen werden: $source");

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $src = $source . DIRECTORY_SEPARATOR . $item;
        $dst = $destination . DIRECTORY_SEPARATOR . $item;
        if (is_dir($src)) {
            copy_tree($src, $dst);
        } elseif (!copy($src, $dst)) {
            throw new RuntimeException("Datei konnte nicht installiert werden: $item");
        }
    }
}

function create_update_config(string $root): void
{
    $dir = $root . DIRECTORY_SEPARATOR . 'config';
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('config/ konnte nicht angelegt werden.');
    }

    $configFile = $dir . DIRECTORY_SEPARATOR . 'update.php';
    if (!file_exists($configFile)) {
        $token = bin2hex(random_bytes(24));
        $php = "<?php\nreturn ['token' => " . var_export($token, true) . "];\n";
        if (file_put_contents($configFile, $php, LOCK_EX) === false) {
            throw new RuntimeException('Update-Konfiguration konnte nicht geschrieben werden.');
        }
        @chmod($configFile, 0640);
    }

    $htaccess = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (!file_exists($htaccess)) {
        @file_put_contents($htaccess, "Require all denied\nDeny from all\n", LOCK_EX);
    }
}

$checks = [
    'PHP >= 8.1' => version_compare(PHP_VERSION, '8.1.0', '>='),
    'ZipArchive' => class_exists('ZipArchive'),
    'HTTPS-Download' => function_exists('curl_init') || filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOL),
    'Webverzeichnis beschreibbar' => is_writable(__DIR__),
];

$installed = file_exists(__DIR__ . '/VERSION') || file_exists(__DIR__ . '/index.html');
$error = null;
$success = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'install') {
    try {
        if ($installed) throw new RuntimeException('Im Zielverzeichnis scheint bereits eine Installation zu liegen. Bitte den integrierten Updater verwenden.');
        foreach ($checks as $label => $ok) {
            if (!$ok) throw new RuntimeException("Systemprüfung fehlgeschlagen: $label");
        }

        $release = latest_release();
        $manifest = manifest_from_release($release);
        if (version_compare(PHP_VERSION, $manifest['min_php'], '<')) {
            throw new RuntimeException("Release {$manifest['version']} benötigt mindestens PHP {$manifest['min_php']}.");
        }

        $packageUrl = release_asset_url($release, $manifest['package']);
        $work = __DIR__ . '/.hd1-install-' . bin2hex(random_bytes(6));
        $stage = $work . '/stage';
        if (!mkdir($stage, 0755, true) && !is_dir($stage)) throw new RuntimeException('Temporäres Installationsverzeichnis konnte nicht angelegt werden.');

        try {
            $zipFile = $work . '/package.zip';
            if (file_put_contents($zipFile, http_get($packageUrl), LOCK_EX) === false) {
                throw new RuntimeException('Release-Paket konnte nicht gespeichert werden.');
            }
            $actualHash = hash_file('sha256', $zipFile);
            if (!hash_equals(strtolower($manifest['sha256']), strtolower((string)$actualHash))) {
                throw new RuntimeException('SHA-256-Prüfung des Release-Pakets fehlgeschlagen.');
            }

            safe_extract($zipFile, $stage);
            if (!is_file($stage . '/index.html') || !is_file($stage . '/VERSION')) {
                throw new RuntimeException('Release-Paket enthält nicht die erwartete Anwendung.');
            }

            copy_tree($stage, __DIR__);
            create_update_config(__DIR__);
            $success = "HD1 Programmer {$manifest['version']} wurde installiert.";
            $installed = true;
        } finally {
            recursive_remove($work);
        }
    } catch (Throwable $ex) {
        $error = $ex->getMessage();
    }
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HD1 Programmer – Installation</title>
<style>
body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 18px;background:#f4f6f8;color:#18212b}main{background:white;border:1px solid #d8dee5;border-radius:14px;padding:24px;box-shadow:0 8px 24px #14223012}h1{margin-top:0}.ok{color:#24723f}.bad{color:#a82d2d}.box{padding:12px 14px;border:1px solid #d8dee5;border-radius:9px;margin:14px 0}.error{border-color:#a82d2d}.success{border-color:#3c8d5c}button{background:#1f5d8f;color:#fff;border:0;border-radius:8px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}code{background:#eef2f5;padding:2px 5px;border-radius:5px}li{margin:6px 0}</style>
</head>
<body><main>
<h1>HD1 Programmer</h1>
<p>Installer für <strong><?= e(HD1_REPOSITORY) ?></strong>.</p>

<?php if ($error): ?><div class="box error"><strong>Fehler:</strong> <?= e($error) ?></div><?php endif; ?>
<?php if ($success): ?>
<div class="box success"><strong><?= e($success) ?></strong><br>Der Update-Schlüssel wurde serverseitig in <code>config/update.php</code> erzeugt und wird aus Sicherheitsgründen nicht über die Webseite ausgegeben.</div>
<p><a href="./">Anwendung öffnen</a></p>
<p><strong>Jetzt <code>install.php</code> aus dem Webverzeichnis löschen.</strong></p>
<?php else: ?>
<h2>Systemprüfung</h2>
<ul>
<?php foreach ($checks as $label => $ok): ?><li class="<?= $ok ? 'ok' : 'bad' ?>"><?= $ok ? '✓' : '✗' ?> <?= e($label) ?></li><?php endforeach; ?>
</ul>
<?php if ($installed): ?>
<div class="box">Eine Installation wurde erkannt. Updates bitte über <code>admin/update.php</code> durchführen.</div>
<?php elseif (!in_array(false, $checks, true)): ?>
<form method="post"><input type="hidden" name="action" value="install"><button type="submit">Aktuelles Stable-Release installieren</button></form>
<?php endif; ?>
<?php endif; ?>

<p style="color:#66717e;font-size:.9rem;margin-top:24px">Der Installer lädt ausschließlich veröffentlichte GitHub-Release-Assets und prüft den im Release-Manifest hinterlegten SHA-256-Wert.</p>
</main></body></html>
