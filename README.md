# Velora

A shopping companion that turns a need and a budget into an explainable product shortlist.

- [Web application source and configuration](web/README.md)
- [macOS desktop setup and release process](desktop/README.md)
- [Download desktop releases](https://github.com/Ninnja10563/Velora/releases)

The desktop application targets Apple Silicon Macs, including M3, running macOS 13 or later. It opens the hosted Velora service in an isolated Electron window. Internet access and permission to access the hosted Site are required; packaging the app does not make a private Site public.

The default product catalog is a clearly labeled demonstration. Live retailer data, approved affiliate identifiers, PostgreSQL sync, external AI interpretation, and verified network conversions require their respective configurations. See the web README for the actual supported behavior and limitations.

## Repository

```text
web/                         Next-compatible React/TypeScript application
desktop/                     Secure Electron wrapper and Apple Silicon packaging
.github/workflows/release.yml Tagged macOS DMG builds and GitHub Releases
```

Major milestones should be committed to GitHub. For a desktop release, update `desktop/package.json` and its lockfile, commit, then push the matching `vX.Y.Z` tag. The release workflow builds an arm64 DMG on macOS, verifies its architecture and disk image, produces a SHA-256 checksum, and publishes the assets only after those steps succeed. The workflow can also rebuild an existing version tag through `workflow_dispatch`.

Without Apple credentials, builds are ad-hoc signed for integrity but are **not Developer ID signed or notarized**. Release notes state the actual configured signing mode. No local Linux check substitutes for a successful macOS build or an M3 launch test.

## Build milestones

Major milestones use a versioned Git commit and matching `vX.Y.Z` tag. The tag triggers the Apple Silicon DMG workflow; a milestone is not a downloadable release until that workflow succeeds and the `.dmg` appears under GitHub Releases.
