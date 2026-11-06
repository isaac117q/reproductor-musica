# Reproductor de Música

Reproductor de música para Windows con sincronización automática de letras.

## Descarga

[⬇️ Descargar última versión](https://github.com/isaac117q/reproductor-musica/releases/latest)

El instalador se descarga automáticamente y la app se actualiza sola al abrirse.

## Características

- Reproducción de audio con letras sincronizadas
- Búsqueda automática de letras (lrclib, letras.com, lyrics.ovh)
- Sincronización automática con la voz (análisis de audio)
- Verificación de letra correcta (idioma, artista, similitud)
- Funciona sin internet (letras guardadas en caché + archivos .lrc)
- Actualizaciones automáticas

## Instalación

1. Descarga el instalador desde [Releases](https://github.com/isaac117q/reproductor-musica/releases/latest)
2. Ejecuta el instalador
3. La app se instala en C:\Users\<usuario>\AppData\Local\Programs\reproductor-musica\
4. Las actualizaciones se descargan e instalan automáticamente

## Uso

- Agrega canciones arrastrando archivos o con el botón "Agregar"
- Las letras se buscan automáticamente al cargar cada pista
- Presiona espacio para reproducir/pausar
- Las letras se sincronizan con la voz automáticamente

## Requisitos

- Windows 10/11 (x64)
- Conexión a internet (solo para la primera descarga de letras)

## Desarrollo

`ash
npm install
npm start          # modo desarrollo
npm run dist       # compilar instalador
npm run dist -- --publish always  # compilar y publicar en GitHub Releases
`

## Licencia

MIT