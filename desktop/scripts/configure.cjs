"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createNavigationPolicy } = require("../navigation.cjs");
const filename = path.join(__dirname, "..", "app-config.json");
const config = JSON.parse(fs.readFileSync(filename, "utf8"));
if (process.env.VELORA_SITE_URL) config.siteUrl = process.env.VELORA_SITE_URL;
createNavigationPolicy(config);
fs.writeFileSync(filename, `${JSON.stringify(config, null, 2)}\n`);
