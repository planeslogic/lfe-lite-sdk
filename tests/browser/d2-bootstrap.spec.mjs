import { expect, test } from "@playwright/test";

test("D2 boots embedded Core in Worker and projects license state", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");

  const result = await page.evaluate(async () => {
    const { LfeLite } = await import("/dist/index.js");
    const runtime = await LfeLite.create();
    const state = await runtime.licenseState();
    await runtime.close();
    return state;
  });

  expect(result.status).toBe("DEVELOPMENT");
  expect(result.write_enabled).toBe(true);
  expect(result.resolve_enabled).toBe(true);
  expect(result.branding_required).toBe(true);
});
