# Velora for macOS

Velora Desktop is an Electron shell around the hosted Velora shopping application. It provides a native application menu, familiar keyboard shortcuts, a persistent isolated browser session, and retailer links that open in the default browser.

The target is **macOS Apple Silicon arm64**, including M3, on macOS 13 or later. Electron 44 requires macOS 13+. [Electron 44 release notes](https://www.electronjs.org/blog/electron-44-0).

The app needs internet access. Its default service URL is `https://velora-shopping-finder.ninnja10563.chatgpt.site`. The Site is private by default: only visitors permitted by the hosted access policy can use it. Desktop packaging does not change the audience or bypass ChatGPT sign-in. Some identity providers reject embedded browser authentication; the Help menu provides a system-browser fallback. The Electron session is separate from the system browser, and credentials are never copied between them.

## Development and packaging

```sh
cd desktop
npm ci
npm test
npm start
```

To package on macOS:

```sh
npm run dist:mac
```

The result is `dist/Velora-<version>-macOS-arm64.dmg`. Icons are generated deterministically from the code-defined brand geometry and converted to ICNS with macOS `sips` and `iconutil`. Set `VELORA_SITE_URL` during packaging to replace the default with another trusted public HTTPS origin. `app-config.json` is included in the built application; this is a build-time configuration, not a browser-controlled navigation setting.

## Security boundary

Remote content has Node integration disabled, context isolation and the renderer sandbox enabled, and no exposed Electron API. Navigation is restricted to the exact Site origin and the explicit authentication origins in `app-config.json`. Wildcard subdomains are not accepted. Popups cannot create additional privileged windows. Permission requests and general downloads are denied. Settings' JSON export is allowed only as a same-Site-origin blob with the expected MIME type and `velora-my-data.json` filename, through a visible save dialog.

The isolated preload observes actual top-level link gestures and sends only their target URL. The main process validates the sending frame and HTTPS URL. First-party outbound product links are resolved through the authenticated Electron session; the resulting retailer URL opens in the system browser without forwarding cookies. Other automatic external navigations are blocked. These choices follow Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

The authentication origin list should be updated deliberately when the hosting provider changes its sign-in flow. Do not relax URL checks or disable web security to bypass authentication problems. Use the browser fallback while investigating unsupported sign-in flows.

## Release pipeline

The GitHub Actions workflow in `.github/workflows/release.yml` runs on `macos-15`. A pushed `vX.Y.Z` tag must exactly match `desktop/package.json`. Manual dispatch takes an existing tag so rebuilding does not silently combine a tag with different source. It installs the lockfile, runs navigation tests, builds the arm64 DMG, checks the app binary's architecture, verifies the disk image, generates a checksum, and uploads a GitHub release with the built-in `GITHUB_TOKEN`.

Use the repository variable `VELORA_SITE_URL` to override the hosted service URL in CI. No personal access token is stored in the repository or required by the release job. The job requests only the repository content permission needed to upload releases.

By default, the app uses an ad-hoc signature with hardened runtime disabled. This provides an integrity signature, not an identified Apple publisher or notarization. macOS may require the user to approve the application in System Settings → Privacy & Security. Do not describe these builds as signed by Apple or notarized.

For Developer ID signing, configure these GitHub repository secrets:

- `MAC_CSC_LINK`: a base64-encoded Developer ID Application certificate in P12 format, or a supported protected certificate source.
- `MAC_CSC_KEY_PASSWORD`: its password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: the account details required for the optional notarization step.

Certificates are used by electron-builder at build time and are not included in the application. Signing is enabled when the certificate exists; notarization additionally requires all Apple account values. Release notes distinguish these configurations. See the pinned builder version's [macOS options](https://www.electron.build/v26/docs/mac/) and [GitHub Actions release guide](https://github.com/electron-userland/electron-builder/blob/master/website/docs/github-actions.md).

No background binary updater is included. Hosted shopping updates appear through the service; Electron and other binary changes require a new DMG release. Use Help → Download Desktop Updates to reach releases. Keep Electron current and run an actual signed or ad-hoc build on an Apple Silicon Mac before describing a release as device-tested.
