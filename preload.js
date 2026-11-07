const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Permite al reproductor buscar letras sin problemas de CORS
// y leer letras sin internet (caché local + archivos .lrc)
contextBridge.exposeInMainWorld('playerAPI', {
  searchLyrics: (query) => ipcRenderer.invoke('search-lyrics', query),
  fetchLetras: (payload) => ipcRenderer.invoke('fetch-letras', payload),

  // Ruta real de un archivo del sistema (para buscar el .lrc vecino)
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return null; }
  },

  // Letras guardadas en el PC (funcionan sin internet)
  loadCachedLyrics: (key) => ipcRenderer.invoke('lyrics-cache-get', key),
  saveCachedLyrics: (key, data) => ipcRenderer.invoke('lyrics-cache-set', key, data),

  // Archivo .lrc junto a la canción
  readLrc: (p) => ipcRenderer.invoke('read-lrc', p),

  // Audio de la pista actual (para alinear la letra con la voz, sin internet)
  readAudio: (p) => ipcRenderer.invoke('read-audio', p),
  // Guardar letra descargada como .lrc junto a la canción (funciona sin internet)
  saveLrc: (p, text) => ipcRenderer.invoke('save-lrc', p, text),

  // Lista de reproducción persistente (sobrevive al cerrar la app)
  loadPlaylist: () => ipcRenderer.invoke('playlist-get'),
  savePlaylist: (data) => ipcRenderer.invoke('playlist-set', data),
  fileExists: (p) => ipcRenderer.invoke('file-exists', p),

  // Diagnóstico: escribir una línea en userData/debug.log
  debugLog: (msg) => ipcRenderer.invoke('debug-log', String(msg || '')).catch(() => {}),

  // Colores de la barra de título nativa según el tema activo
  setTitleBarColors: (colors) => ipcRenderer.send('titlebar-colors', colors),

  // Actualizaciones autom�ticas
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, v) => cb(v)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, v) => cb(v))
});
