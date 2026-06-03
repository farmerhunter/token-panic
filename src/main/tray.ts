import { Tray, BrowserWindow, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 380;

// ---- Tray icon generation (minimal template icon) ----

function createTrayIcon(): NativeImage {
  // 16×16 template icon: a coin/token (circle with ¥ line through center).
  // macOS inverts template images for dark mode automatically.

  const size = 16;
  const scale = 2;
  const realSize = size * scale;
  const buf = Buffer.alloc(realSize * realSize * 4);

  const cx = realSize / 2;
  const cy = realSize / 2;
  const outerR = 7 * scale;
  const innerR = 2.5 * scale; // slim ring, like a coin edge

  for (let y = 0; y < realSize; y++) {
    for (let x = 0; x < realSize; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * realSize + x) * 4;

      // Coin ring
      if (dist <= outerR && dist > innerR) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
      // Horizontal ¥ bar through center
      else if (dist <= innerR && Math.abs(dy) <= 1.2 * scale) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
      // Vertical ¥ bar from top of inner circle to bottom
      else if (dist <= innerR && Math.abs(dx) <= 1 * scale) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
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
      // Notify renderer so it can request fresh data (P2-K)
      panelWindow.webContents.send('panel:shown');
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
