# Reproducible geometric placeholder branding; replace with final artwork later.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskAssetRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets'))

foreach ($taskAsset in @('icon.png', 'android-icon-foreground.png')) {
    $taskBitmap = [Drawing.Bitmap]::new(1024, 1024)
    $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskGraphics.Clear([Drawing.ColorTranslator]::FromHtml('#EAF1E7'))
    if ($taskAsset -eq 'android-icon-foreground.png') {
        $taskGraphics.Clear([Drawing.Color]::Transparent)
    }
    $taskBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#246B50'))
    $taskPen = [Drawing.Pen]::new($taskBrush, 32)
    $taskPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $taskPen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $taskGraphics.DrawLine($taskPen, 506, 694, 506, 416)
    $taskLeaf = [Drawing.Drawing2D.GraphicsPath]::new()
    $taskLeaf.AddBezier(506, 530, 370, 524, 352, 422, 352, 382)
    $taskLeaf.AddBezier(352, 382, 472, 366, 538, 442, 506, 530)
    $taskLeaf.CloseFigure()
    $taskGraphics.FillPath($taskBrush, $taskLeaf)
    $taskLeaf.Reset()
    $taskLeaf.AddBezier(506, 466, 498, 334, 604, 320, 677, 324)
    $taskLeaf.AddBezier(677, 324, 677, 420, 602, 485, 506, 466)
    $taskLeaf.CloseFigure()
    $taskGraphics.FillPath($taskBrush, $taskLeaf)
    $taskBitmap.Save((Join-Path $taskAssetRoot $taskAsset), [Drawing.Imaging.ImageFormat]::Png)
    $taskLeaf.Dispose()
    $taskPen.Dispose()
    $taskBrush.Dispose()
    $taskGraphics.Dispose()
    $taskBitmap.Dispose()
}
