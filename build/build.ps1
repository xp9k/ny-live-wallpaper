# Full Windows pipeline: assets and ZIP, verification, then the RPM built and
# tested by build/rpm.sh inside an offline podman container in WSL.
param(
    [string]$Distro = 'dno-build',
    [string]$Image = $env:RPM_BUILD_IMAGE,
    [ValidateSet('mos12','mos13','all')][string]$Target = 'all'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$linuxRoot = '/mnt/' + $projectRoot.Substring(0, 1).ToLowerInvariant() + $projectRoot.Substring(2).Replace('\', '/')
Push-Location $projectRoot
try {
    & node build/build.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Asset build failed.' }
    & node build/verify.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Verification failed.' }
    if (-not $Image) {
        $Image = & wsl.exe -d $Distro -u root --exec podman images --filter 'reference=localhost/dno-tool-build*' --format '{{.Repository}}:{{.Tag}}' |
            Select-Object -First 1
    }
    if (-not $Image) { throw 'No RPM builder image. Pass -Image or set RPM_BUILD_IMAGE.' }
    & wsl.exe -d $Distro -u root --exec podman run --rm --network none --entrypoint /bin/sh `
        --mount "type=bind,source=$linuxRoot,destination=/work" $Image /work/build/rpm.sh $Target
    if ($LASTEXITCODE -ne 0) { throw 'RPM build failed.' }
    $releaseFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -File)
    $expected = if ($Target -eq 'all') { 3 } else { 2 }
    if ($releaseFiles.Count -ne $expected) { throw "dist must contain exactly $expected release files." }
    $releaseFiles | Select-Object Name, Length
} finally {
    Pop-Location
}
