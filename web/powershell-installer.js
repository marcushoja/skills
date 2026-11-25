const invalidWindowsPart = /[<>:"|?*]|[ .]$|^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/iu;

export function renderPowerShellInstaller(target, entries, httpsOnly) {
  const plan = entries.map(({ id, files }) => ({
    id,
    files: files.map(({ file, parts, url, sha256 }) => {
      if (parts.some((part) => invalidWindowsPart.test(part))) {
        throw new Error(`Unter Windows ist dieser Dateipfad nicht möglich: ${file}`);
      }
      return { file, url, sha256 };
    }),
  }));
  return `& {
  # Im Projektstamm ausführen. Eigene und nicht ausgewählte Skill-Ordner bleiben unverändert.
  # Alle Dateien werden heruntergeladen und geprüft, bevor ein Hub-Skill ersetzt wird.
  $ErrorActionPreference = 'Stop'
  $target = '${target}'
  $httpsOnly = ${httpsOnly ? '$true' : '$false'}
  $planJson = @'
${JSON.stringify(plan, null, 2).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}
'@
${installer}
}
`;
}

const installer = String.raw`  $plan = ConvertFrom-Json -InputObject $planJson
  $marker = '.skills-hub-managed'

  function Get-HubItem($path) {
    try { Get-Item -LiteralPath $path -Force }
    catch [System.Management.Automation.ItemNotFoundException] { }
  }

  function Test-HubLink($item) {
    return ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  }

  function New-HubDirectory($path) {
    $item = Get-HubItem $path
    if (Test-HubLink $item) { throw "Kein Einbau über einen Symlink oder eine Junction: $path" }
    [void][IO.Directory]::CreateDirectory($path)
  }

  function Get-HubDestination($id) {
    $path = [IO.Path]::Combine($target, $id)
    $item = Get-HubItem $path
    if ($null -ne $item) {
      if ((Test-HubLink $item) -or -not $item.PSIsContainer) {
        throw "Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten: $path"
      }
      $markerPath = [IO.Path]::Combine($path, $marker)
      $tag = Get-HubItem $markerPath
      if ($null -eq $tag -or (Test-HubLink $tag) -or $tag.PSIsContainer -or
          [IO.File]::ReadAllText($markerPath).TrimEnd([char[]]@(13, 10)) -cne "skills-hub:$id") {
        throw "Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten: $path"
      }
    }
    return $item
  }

  function Save-HubFile($url, $path) {
    $uri = [Uri]$url
    for ($hop = 0; $hop -le 10; $hop++) {
      if (($uri.Scheme -notin @('http', 'https')) -or ($httpsOnly -and $uri.Scheme -ne 'https')) {
        throw "Nicht erlaubtes Download-Protokoll: $uri"
      }
      $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      try {
        if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308) -and $response.Headers.Location) {
          $uri = [Uri]::new($uri, $response.Headers.Location)
          continue
        }
        if (-not $response.IsSuccessStatusCode) { throw "HTTP $([int]$response.StatusCode): $uri" }
        $output = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { [void]$response.Content.CopyToAsync($output).GetAwaiter().GetResult() }
        finally { $output.Dispose() }
        return
      } finally { $response.Dispose() }
    }
    throw "Zu viele Download-Weiterleitungen: $url"
  }

  $location = Get-Location
  if ($location.Provider.Name -ne 'FileSystem') { throw 'Bitte im Zielprojekt im Dateisystem ausführen.' }
  $project = $location.ProviderPath
  if ([IO.Path]::GetPathRoot($project) -eq $project) { throw 'Bitte im Zielprojekt ausführen, nicht im Wurzelverzeichnis.' }
  $target = [IO.Path]::GetFullPath([IO.Path]::Combine($project, $target))
  New-HubDirectory ([IO.Path]::GetDirectoryName($target))
  New-HubDirectory $target
  $lock = [IO.Path]::Combine($target, '.skills-hub.lock')
  try { $lockStream = [IO.File]::Open($lock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
  catch { throw "Installationssperre vorhanden oder nicht anlegbar: $lock ($($_.Exception.Message))" }

  $stage = $null
  $client = $null
  $preserve = $false
  try {
    foreach ($skill in $plan) { [void](Get-HubDestination $skill.id) }
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $stagePath = [IO.Path]::Combine($target, ('.skills-hub.' + [Guid]::NewGuid().ToString('N')))
    New-HubDirectory $stagePath
    $stage = $stagePath
    $new = [IO.Path]::Combine($stage, 'new')
    $backup = [IO.Path]::Combine($stage, 'backup')
    New-HubDirectory $backup
    foreach ($skill in $plan) {
      $stagedSkill = [IO.Path]::Combine($new, $skill.id)
      New-HubDirectory $stagedSkill
      foreach ($file in $skill.files) {
        $stagedFile = [IO.Path]::GetFullPath([IO.Path]::Combine($stagedSkill, $file.file))
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($stagedFile))
        Save-HubFile $file.url $stagedFile
        if ((Get-FileHash -LiteralPath $stagedFile -Algorithm SHA256).Hash -ne $file.sha256) {
          throw "Prüfsumme stimmt nicht: $stagedFile (bitte Hub neu laden)"
        }
      }
      [IO.File]::WriteAllText([IO.Path]::Combine($stagedSkill, $marker), "skills-hub:$($skill.id)" + [char]10)
    }

    # Bereits verwaltete Ordner sichern und bei fehlgeschlagenem Austausch zurücklegen.
    foreach ($skill in $plan) { [void](Get-HubDestination $skill.id) }
    $preserve = $true
    foreach ($skill in $plan) {
      $dest = [IO.Path]::Combine($target, $skill.id)
      $saved = [IO.Path]::Combine($backup, $skill.id)
      if (Get-HubDestination $skill.id) { [IO.Directory]::Move($dest, $saved) }
      try { [IO.Directory]::Move([IO.Path]::Combine($new, $skill.id), $dest) }
      catch {
        if ([IO.Directory]::Exists($saved) -and -not (Get-HubItem $dest)) { [IO.Directory]::Move($saved, $dest) }
        throw
      }
    }
    $preserve = $false
    Write-Output "Installiert unter $($target):"
    foreach ($skill in $plan) { Write-Output "  $($skill.id)" }
  } finally {
    try {
      if ($client) { $client.Dispose() }
      if ($stage) {
        if ($preserve) { Write-Warning "Einbau unterbrochen. Sicherungen können hier liegen: $backup" }
        else { [IO.Directory]::Delete($stage, $true) }
      }
    } finally {
      $lockStream.Dispose()
      [IO.File]::Delete($lock)
    }
  }`;
