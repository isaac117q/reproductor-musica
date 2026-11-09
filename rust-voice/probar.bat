@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo ============================================
  echo   ANALIZADOR DE VOZ (Rust) - PRUEBA
  echo ============================================
  echo.
  echo Arrastra un archivo de audio sobre este .bat
  echo Formatos: MP3, M4A, MP4, OGG, FLAC, WAV
  echo.
  pause
  exit /b
)

echo Analizando: %~nx1
echo.
for /f %%i in ('powershell -NoProfile -Command "$t=Get-Date; & '%~dp0voice-analyzer.exe' '%~1' | Set-Content -Encoding UTF8 '%~dp0resultado.json'; $ms=((Get-Date)-$t).TotalMilliseconds; Write-Output ([math]::Round($ms))"') do set MS=%%i

echo Tiempo: %MS% ms
echo Resultado guardado en: resultado.json
echo.
powershell -NoProfile -Command "$j=Get-Content -Raw -Encoding UTF8 '%~dp0resultado.json' | ConvertFrom-Json; Write-Host ('Duracion: ' + [math]::Round($j.duration,1) + ' s'); Write-Host ('Frases vocales: ' + $j.phrases.Count); Write-Host ('Onsets: ' + $j.onsets.Count); $c=($j.phrases | Measure-Object -Property eff -Sum).Sum; if($j.duration -gt 0){ Write-Host ('Cantado aprox: ' + [math]::Round($c,1) + ' s (' + [math]::Round(100*$c/$j.duration,0) + '%)') }; Write-Host ''; Write-Host 'Primeras frases:'; $j.phrases | Select-Object -First 10 | ForEach-Object { Write-Host ('  ' + [math]::Round($_.t,2) + ' -> ' + [math]::Round($_.end,2) + ' s   eff=' + [math]::Round($_.eff,2) + ' s') }"
echo.
pause
