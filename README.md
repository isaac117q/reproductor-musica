# Reproductor de Música

Reproductor de música para Windows con sincronización automática de letras.

## Descarga

[⬇️ Descargar última versión](https://github.com/isaac117q/reproductor-musica/releases/latest)

El instalador está siempre en [Releases](https://github.com/isaac117q/reproductor-musica/releases/latest). Cuando exista una versión nueva, la app lo avisa y se actualiza con el botón **Actualizar** (las actualizaciones son manuales, no se instalan solas).

## Características

- Reproducción de audio con letras sincronizadas
- Búsqueda automática de letras (lrclib, letras.com, lyrics.ovh)
- Sincronización automática con la voz (análisis de audio)
- Las letras LRC resaltan palabra por palabra siguiendo la voz del cantante, con relleno progresivo (efecto karaoke fluido)
- Indicador automático de sincronía con la voz: avisa si la letra va adelantada, atrasada o no coincide (solo informa, no cambia los tiempos)
- Si la letra no venía sincronizada, el indicador muestra «Ajuste automático» en ámbar en vez de un porcentaje verde engañoso; primero se intenta descargar una letra sincronizada real
- Verificación de letra correcta (idioma, artista, similitud)
- Funciona sin internet (letras guardadas en caché + archivos .lrc)
- Actualizaciones manuales desde el botón Actualizar
- El botón Actualizar descarga solo la app (~4 MB) y, al pulsar «Instalar», la cierra, la sustituye y la reinicia sola (sin instalación del sistema)

## Instalación

1. Descarga el instalador desde [Releases](https://github.com/isaac117q/reproductor-musica/releases/latest)
2. Ejecuta el instalador
3. La app se instala en C:\Users\<usuario>\AppData\Local\Programs\reproductor-musica\
4. Cuando haya una versión nueva, usa el botón **Actualizar** de la app

## Uso

- Agrega canciones arrastrando archivos o con el botón "Agregar"
- Las letras se buscan automáticamente al cargar cada pista
- Presiona espacio para reproducir/pausar
- Las letras se sincronizan con la voz automáticamente

## Requisitos

- Windows 10/11 (x64)
- Conexión a internet (solo para la primera descarga de letras)

## Desarrollo



## Licencia

MIT
