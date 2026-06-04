import { Tray, BrowserWindow, nativeImage, screen, app, Menu } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 380;

// ---- Tray icon generation (template icon) ----

function createTrayIcon(): NativeImage {
  const size = 22;
  const scale = 3;
  const realSize = size * scale;
  const buf = Buffer.alloc(realSize * realSize * 4);

  const setPixel = (x: number, y: number, alpha = 255, clear = false) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= realSize || iy >= realSize) return;
    const i = (iy * realSize + ix) * 4;
    buf[i] = 0;
    buf[i + 1] = 0;
    buf[i + 2] = 0;
    buf[i + 3] = clear ? 0 : Math.max(buf[i + 3], alpha);
  };

  const pointToSegmentDistance = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  const drawLine = (ax: number, ay: number, bx: number, by: number, width: number, clear = false) => {
    const minX = Math.floor(Math.min(ax, bx) - width);
    const maxX = Math.ceil(Math.max(ax, bx) + width);
    const minY = Math.floor(Math.min(ay, by) - width);
    const maxY = Math.ceil(Math.max(ay, by) + width);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointToSegmentDistance(x, y, ax, ay, bx, by) <= width / 2) {
          setPixel(x, y, 255, clear);
        }
      }
    }
  };

  const fillPolygon = (points: Array<[number, number]>) => {
    const minY = Math.floor(Math.min(...points.map((p) => p[1])));
    const maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length; i += 2) {
        for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x++) {
          setPixel(x, y);
        }
      }
    }
  };

  const p = (x: number, y: number): [number, number] => [x * scale, y * scale];
  const cubic = (
    from: [number, number],
    c1: [number, number],
    c2: [number, number],
    to: [number, number],
    steps = 18,
  ): Array<[number, number]> => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      points.push([
        mt * mt * mt * from[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * to[0],
        mt * mt * mt * from[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * to[1],
      ]);
    }
    return points;
  };

  const fanStart = p(3.4, 17.8);
  const fanTop = p(11, 4.8);
  const fanEnd = p(18.6, 17.8);
  fillPolygon([
    ...cubic(fanStart, p(4.4, 9.8), p(7.1, 4.8), fanTop),
    ...cubic(fanTop, p(14.9, 4.8), p(17.6, 9.8), fanEnd).slice(1),
    p(11, 14.9),
  ]);

  const clearDollarStroke = 1.5 * scale;
  const clearDollarStem = 1.15 * scale;
  const dollarCurve = [
    ...cubic(p(13.5, 9.9), p(12.6, 9.4), p(10.3, 9.4), p(9.4, 10.4), 8),
    ...cubic(p(9.4, 10.4), p(8.6, 11.3), p(9.4, 12.0), p(11.1, 12.5), 8).slice(1),
    ...cubic(p(11.1, 12.5), p(13.3, 13.1), p(14.3, 14.0), p(13.3, 15.2), 8).slice(1),
    ...cubic(p(13.3, 15.2), p(12.3, 16.4), p(9.7, 16.4), p(8.5, 15.6), 8).slice(1),
  ];
  for (let i = 0; i < dollarCurve.length - 1; i++) {
    drawLine(dollarCurve[i][0], dollarCurve[i][1], dollarCurve[i + 1][0], dollarCurve[i + 1][1], clearDollarStroke, true);
  }
  drawLine(11 * scale, 8.8 * scale, 11 * scale, 16.8 * scale, clearDollarStem, true);

  const icon = nativeImage.createFromBitmap(buf, {
    width: realSize,
    height: realSize,
    scaleFactor: scale,
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
  if (!app.isPackaged) {
    // Dev: load from Vite dev server
    panelWindow.loadURL('http://localhost:5173');
  } else {
    // Packaged: load built HTML from app resources
    // __dirname is dist/main/main/ in dev, or the packaged app's asar root
    panelWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  const showPanel = () => {
    positionPanel(panelWindow, tray);
    panelWindow.show();
    panelWindow.focus();
    // Notify renderer so it can request fresh data (P2-K)
    panelWindow.webContents.send('panel:shown');
  };

  const showSettings = () => {
    showPanel();
    panelWindow.webContents.send('panel:open-settings');
  };

  const createContextMenu = () => {
    const loginSettings = app.getLoginItemSettings();
    return Menu.buildFromTemplate([
      { label: '打开面板', click: showPanel },
      { label: '设置', click: showSettings },
      { type: 'separator' },
      {
        label: '开机启动',
        type: 'checkbox',
        checked: loginSettings.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
        },
      },
      { type: 'separator' },
      { label: '退出 token-panic', click: () => app.quit() },
    ]);
  };

  tray.on('click', () => {
    if (panelWindow.isVisible()) {
      panelWindow.hide();
    } else {
      showPanel();
    }
  });

  tray.on('right-click', () => {
    if (panelWindow.isVisible()) {
      panelWindow.hide();
    }
    tray.popUpContextMenu(createContextMenu());
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
