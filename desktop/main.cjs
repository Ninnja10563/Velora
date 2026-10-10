"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const { createNavigationPolicy, parseHttpsUrl } = require("./navigation.cjs");
const config = require("./app-config.json");
const policy = createNavigationPolicy(config);
let mainWindow;
let openingExternal = false;

app.enableSandbox();
app.setName("Velora");

function mainPreferences() {
  return {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    devTools: !app.isPackaged,
    preload: path.join(__dirname, "preload.cjs"),
    additionalArguments: [`--velora-site-origin=${policy.siteOrigin}`],
  };
}

async function loadHome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { await mainWindow.loadURL(policy.siteOrigin); } catch { /* did-fail-load provides recovery. */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Velora", width: 1380, height: 920, minWidth: 390, minHeight: 620,
    show: false, backgroundColor: "#fcfbf9", autoHideMenuBar: true,
    webPreferences: mainPreferences(),
  });
  const contents = mainWindow.webContents;
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  const handleDownload = (event, item, sourceContents) => {
    const allowed = sourceContents === contents && policy.isSite(contents.getURL()) && policy.canDownloadExport(item.getURL(), item.getMimeType(), item.getFilename());
    if (!allowed) { event.preventDefault(); return; }
    // Only Velora's explicit JSON export can reach a user-visible save dialog.
    // No download payload or filesystem API is exposed to the renderer.
    item.setSaveDialogOptions({
      title: "Export your Velora data",
      defaultPath: path.join(app.getPath("downloads"), "velora-my-data.json"),
      filters: [{ name: "JSON data", extensions: ["json"] }],
    });
  };
  session.on("will-download", handleDownload);
  contents.once("destroyed", () => session.removeListener("will-download", handleDownload));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, url) => { if (!policy.canNavigate(url)) event.preventDefault(); });
  contents.on("will-redirect", (event, url) => { if (!policy.canNavigate(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    // Trusted authentication popups reuse the isolated window. Arbitrary popups are denied.
    if (policy.canNavigate(url) && !policy.isOutbound(url)) void contents.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  contents.on("page-title-updated", (event) => { event.preventDefault(); mainWindow?.setTitle("Velora"); });
  contents.on("did-fail-load", async (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info", title: "Velora is having trouble connecting", message: "The shopping service could not be reached.",
      detail: "Velora needs an internet connection and access to its hosted site. Sign-in may be required. You can try again or open the site in your browser.",
      buttons: ["Try again", "Open in browser", "Close"], defaultId: 0, cancelId: 2,
    });
    if (result.response === 0) void loadHome();
    if (result.response === 1) await shell.openExternal(policy.siteOrigin);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
  void loadHome();
}

ipcMain.on("velora:link-gesture", async (event, value) => {
  if (!mainWindow || openingExternal || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !policy.isSite(event.senderFrame.url)) return;
  let url = parseHttpsUrl(value);
  if (!url) return;
  openingExternal = true;
  try {
    if (policy.isOutbound(url.href)) {
      // Resolve through this authenticated Electron session; forward no cookies to the retailer.
      const response = await mainWindow.webContents.session.fetch(url.href, { redirect: "manual", credentials: "include", signal: AbortSignal.timeout(8000) });
      const destination = response.headers.get("location");
      url = response.status >= 300 && response.status < 400 && destination ? parseHttpsUrl(new URL(destination, policy.siteOrigin).href) : null;
      if (!url || policy.canNavigate(url.href)) throw new Error("The retailer link could not be resolved.");
    } else if (policy.canNavigate(url.href)) {
      await mainWindow.loadURL(url.href);
      return;
    }
    await shell.openExternal(url.href);
  } catch {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, { type: "info", title: "Link unavailable", message: "This retailer link could not be opened.", detail: "Try again after signing in, or use Velora in your browser.", buttons: ["OK"] });
  } finally { openingExternal = false; }
});

function installMenu() {
  const navigation = () => mainWindow?.webContents.navigationHistory;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Velora", submenu: [
      { role: "about" }, { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.loadURL(`${policy.siteOrigin}/settings`) },
      { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" },
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [
      { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: loadHome },
      { label: "Back", accelerator: "CmdOrCtrl+[", click: () => { if (navigation()?.canGoBack()) navigation().goBack(); } },
      { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => { if (navigation()?.canGoForward()) navigation().goForward(); } },
      { role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
    { role: "help", submenu: [
      { label: "Open Velora in Browser", click: () => shell.openExternal(policy.siteOrigin) },
      { label: "Download Desktop Updates", click: () => shell.openExternal("https://github.com/Ninnja10563/Velora/releases") },
    ] },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { installMenu(); createWindow(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
