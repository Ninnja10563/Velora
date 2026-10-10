"use strict";

// GitHub supplies an empty string for an unconfigured optional secret. Builder
// treats a defined CSC_LINK, even "", as a certificate path and resolves it to
// the working directory. Remove absent values before its signing phase runs.
for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
  if (process.env[key] !== undefined && process.env[key].trim() === "") delete process.env[key];
}

const hasCertificate = Boolean(process.env.CSC_LINK);
const canNotarize = Boolean(hasCertificate && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

module.exports = {
  appId: "com.velora.shopping",
  productName: "Velora",
  asar: true,
  directories: { output: "dist", buildResources: "assets" },
  files: ["main.cjs", "preload.cjs", "navigation.cjs", "app-config.json", "package.json"],
  artifactName: "Velora-${version}-macOS-${arch}.${ext}",
  mac: {
    target: [{ target: "dmg", arch: ["arm64"] }],
    category: "public.app-category.lifestyle",
    icon: "assets/icon.icns",
    minimumSystemVersion: "13.0.0",
    hardenedRuntime: hasCertificate,
    notarize: canNotarize,
    ...(hasCertificate ? {} : { identity: "-" }),
  },
  dmg: { title: "Velora ${version}", sign: false },
  publish: null,
};
