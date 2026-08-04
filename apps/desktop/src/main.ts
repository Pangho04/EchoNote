import path from 'node:path';

import { app, BrowserWindow } from 'electron';

const DEVELOPMENT_RENDERER_URL = 'http://127.0.0.1:5173';

const createWindow = async () => {
  const window = new BrowserWindow({
    height: 780,
    minHeight: 640,
    minWidth: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
    width: 1180,
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  const rendererUrl =
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL === DEVELOPMENT_RENDERER_URL
      ? DEVELOPMENT_RENDERER_URL
      : undefined;

  if (rendererUrl) {
    await window.loadURL(rendererUrl);

    return;
  }

  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
};

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
