const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getProducts: (search) => ipcRenderer.invoke('get-products', search),
  addProduct: (data) => ipcRenderer.invoke('add-product', data),
  updateProduct: (data) => ipcRenderer.invoke('update-product', data),
  deleteProduct: (id) => ipcRenderer.invoke('delete-product', id),
  addMovement: (data) => ipcRenderer.invoke('add-movement', data),
  getRecentMovements: () => ipcRenderer.invoke('get-recent-movements'),
  getAllMovements: (filters) => ipcRenderer.invoke('get-all-movements', filters),
  backup: () => ipcRenderer.invoke('backup-db'),
  exportToExcel: (data) => ipcRenderer.invoke('export-excel', data),
  
  // Events
  onNotification: (callback) => ipcRenderer.on('notification', (_, message) => callback(message))
});