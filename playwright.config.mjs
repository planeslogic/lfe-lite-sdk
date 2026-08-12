import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:8280",
    launchOptions: {
      args: ["--host-resolver-rules=MAP app.customer.com 127.0.0.1"],
    },
  },
  webServer: {
    command: "python3 -m http.server 8280 --bind 0.0.0.0",
    port: 8280,
    reuseExistingServer: false,
  },
});
