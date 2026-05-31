# SECOURS UNIQUEMENT — écrase resources/icon.png et splash.png depuis reveal.png (sans tagline).
# Si tu as déjà des PNG custom dans resources/, ne pas lancer (voir resources/README.md).
# Génère icon 1024² et splash 2732² depuis reveal.png.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$source = Join-Path $root "reveal.png"
$outDir = Join-Path $root "resources"
$iconOut = Join-Path $outDir "icon.png"
$splashOut = Join-Path $outDir "splash.png"
$bgColor = [System.Drawing.Color]::FromArgb(255, 13, 15, 30)

function New-CenteredSquareImage {
    param(
        [int]$Size,
        [int]$LogoMaxWidth,
        [int]$LogoMaxHeight,
        [string]$OutPath,
        [System.Drawing.Image]$Logo
    )

    $scale = [Math]::Min($LogoMaxWidth / $Logo.Width, $LogoMaxHeight / $Logo.Height)
    $w = [int][Math]::Round($Logo.Width * $scale)
    $h = [int][Math]::Round($Logo.Height * $scale)

    $canvas = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($bgColor)

    $destX = [int](($Size - $w) / 2)
    $destY = [int](($Size - $h) / 2)
    $g.DrawImage($Logo, $destX, $destY, $w, $h)
    $g.Dispose()

    $canvas.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
}

if (-not (Test-Path $source)) {
    Write-Error "reveal.png introuvable: $source"
    exit 1
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$logo = [System.Drawing.Image]::FromFile($source)
try {
    New-CenteredSquareImage -Size 1024 -LogoMaxWidth 920 -LogoMaxHeight 560 -OutPath $iconOut -Logo $logo
    New-CenteredSquareImage -Size 2732 -LogoMaxWidth 2200 -LogoMaxHeight 1320 -OutPath $splashOut -Logo $logo
}
finally {
    $logo.Dispose()
}

foreach ($file in @($iconOut, $splashOut)) {
    $img = [System.Drawing.Image]::FromFile($file)
    $name = Split-Path -Leaf $file
    Write-Output "OK $name -> $($img.Width)x$($img.Height)"
    $img.Dispose()
}
