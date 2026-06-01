import { Tray, BrowserWindow, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 280;

// ---- Tray icon generation (minimal template icon) ----

function createTrayIcon(): NativeImage {
  // Create a 16x16 template icon: a simple filled circle
  // On macOS, setTemplateImage(true) means dark pixels show as black in light mode
  // and white in dark mode, with transparent background.

  const size = 16;
  const scale = 2; // Retina
  const realSize = size * scale;
  const buf = Buffer.alloc(realSize * realSize * 4);

  const cx = realSize / 2;
  const cy = realSize / 2;
  const outerR = 7 * scale;
  const innerR = 3 * scale;

  for (let y = 0; y < realSize; y++) {
    for (let x = 0; x < realSize; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * realSize + x) * 4;

      if (dist <= outerR && dist > innerR) {
        // Ring: dark (template-compatible)
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = 255;
      }
      // else: transparent
    }
  }

  const icon = nativeImage.createFromBitmap(buf, {
    width: realSize,
    height: realSize,
    scaleFactor: 2.0,
  });

  icon.setTemplateImage(true);
  return icon;
}

// ---- Tray and panel window ----

export interface TrayHandle {
  tray: Tray;
  panelWindow: BrowserWindow;
}

export function createTray(): TrayHandle {
  const icon = createTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip('token恐慌');

  // Create the panel window (hidden initially)
  const panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load renderer
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    // Dev: load from Vite dev server
    panelWindow.loadURL('http://localhost:5173');
  } else {
    // Production: load built files
    panelWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Toggle panel on tray click
  tray.on('click', () => {
    if (panelWindow.isVisible()) {
      panelWindow.hide();
    } else {
      positionPanel(panelWindow, tray);
      panelWindow.show();
    }
  });

  // Hide panel when clicking outside
  panelWindow.on('blur', () => {
    panelWindow.hide();
  });

  return { tray, panelWindow };
}

function positionPanel(win: BrowserWindow, tray: Tray): void {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  const { width } = win.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height);

  // Ensure panel stays within screen bounds
  const workArea = display.workArea;
  const finalX = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);

  win.setPosition(finalX, y);
}
