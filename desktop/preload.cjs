"use strict";

// No Electron/Node API is exposed to the page. Only real link gestures are relayed.
const { ipcRenderer } = require("electron");
const siteOrigin = process.argv.find((argument) => argument.startsWith("--velora-site-origin="))?.slice("--velora-site-origin=".length);

function handleLink(event) {
  if (!event.isTrusted || (event.button !== 0 && event.button !== 1) || window.top !== window || location.origin !== siteOrigin) return;
  const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
  if (!anchor) return;
  let url;
  try { url = new URL(anchor.href); } catch { return; }
  const outbound = url.origin === siteOrigin && url.pathname === "/api/outbound";
  if (!outbound && url.origin === siteOrigin) return;
  if ((url.protocol !== "https:" && !(outbound && url.protocol === "http:")) || url.username || url.password) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send("velora:link-gesture", url.href);
}

window.addEventListener("click", handleLink, true);
window.addEventListener("auxclick", handleLink, true);
