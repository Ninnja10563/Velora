"use strict";

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
