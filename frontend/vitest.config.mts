import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Unit tests only; Playwright specs in e2e/ are run by `npm run test:e2e`.
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
