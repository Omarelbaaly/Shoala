const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db = require('./database');
const xlsx = require('xlsx');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: "مخازن الشعلة",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment for debugging
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  db.init(userDataPath);
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('login', async (event, { username, password }) => {
  try {
    const user = await db.login(username, password);
    return { success: !!user, user };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-stats', async () => await db.getStats());
ipcMain.handle('get-products', async (_, search) => await db.getProducts(search));
ipcMain.handle('add-product', async (_, data) => await db.addProduct(data));
ipcMain.handle('update-product', async (_, data) => await db.updateProduct(data));
ipcMain.handle('delete-product', async (_, id) => await db.deleteProduct(id));
ipcMain.handle('add-movement', async (_, data) => await db.addMovement(data));
ipcMain.handle('get-recent-movements', async () => await db.getRecentMovements());
ipcMain.handle('get-all-movements', async (_, filters) => await db.getAllMovements(filters));

ipcMain.handle('backup-db', async () => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'حفظ نسخة احتياطية',
    defaultPath: 'shoala_backup.db',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  });

  if (filePath) {
    try {
      await db.backup(filePath, app.getPath('userData'));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, canceled: true };
});

ipcMain.handle('export-excel', async (_, { data, filename }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'تصدير إلى Excel',
    defaultPath: filename || 'report.xlsx',
    filters: [{ name: 'Excel File', extensions: ['xlsx'] }]
  });

  if (filePath) {
    try {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(wb, ws, "Report");
      xlsx.writeFile(wb, filePath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false };
});