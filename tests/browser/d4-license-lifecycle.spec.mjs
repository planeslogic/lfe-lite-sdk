import { expect, test } from "@playwright/test";

const license = process.env.LFE_D4_PRODUCTION_LICENSE_JSON;
const BADGE_SELECTOR = "[data-planeslogic-lfe-lite-branding]";

test("D4 signed license reconciles branding and automatically refreshes at expiry", async ({ page }) => {
  test.skip(!license, "LFE_D4_PRODUCTION_LICENSE_JSON is required");

  await page.goto("http://app.customer.com:8280/tests/browser/fixture.html");

  const initial = await page.evaluate(async (licenseJson) => {
    const { LfeLite } = await import("/dist/index.js");
    const lfe = await LfeLite.create({ license: licenseJson });
    window.__d4_signed_lfe = lfe;

    const state = await lfe.licenseState();
    return {
      state,
      badgeCount: document.querySelectorAll(
        "[data-planeslogic-lfe-lite-branding]",
      ).length,
    };
  }, license);

  expect(initial.state.status).toBe("VALID");
  expect(initial.state.write_enabled).toBe(true);
  expect(initial.state.branding_required).toBe(false);
  expect(initial.badgeCount).toBe(0);

  const missing = await page.evaluate(async () => {
    const state = await window.__d4_signed_lfe.setLicense(null);
    return {
      state,
      badgeCount: document.querySelectorAll(
        "[data-planeslogic-lfe-lite-branding]",
      ).length,
    };
  });

  expect(missing.state.write_enabled).toBe(false);
  expect(missing.state.resolve_enabled).toBe(true);
  expect(missing.state.branding_required).toBe(true);
  expect(missing.badgeCount).toBe(1);

  const restored = await page.evaluate(async (licenseJson) => {
    const state = await window.__d4_signed_lfe.setLicense(licenseJson);
    window.dispatchEvent(new Event("focus"));
    return {
      state,
      badgeCount: document.querySelectorAll(
        "[data-planeslogic-lfe-lite-branding]",
      ).length,
    };
  }, license);

  expect(restored.state.status).toBe("VALID");
  expect(restored.state.branding_required).toBe(false);
  expect(restored.badgeCount).toBe(0);

  await expect.poll(
    async () => page.evaluate(async () => (await window.__d4_signed_lfe.licenseState()).status),
    { timeout: 12_000, intervals: [100, 250, 500] },
  ).toBe("EXPIRED");

  const expired = await page.evaluate(async () => {
    const state = await window.__d4_signed_lfe.licenseState();
    let writeCode = null;

    await window.__d4_signed_lfe.define({
      keyId: 99,
      name: "d4_expired_write",
      type: "bool",
    });

    try {
      await window.__d4_signed_lfe.add(999n, { d4_expired_write: true });
    } catch (error) {
      writeCode = error.code;
    }

    return {
      state,
      writeCode,
      badgeCount: document.querySelectorAll(
        "[data-planeslogic-lfe-lite-branding]",
      ).length,
    };
  });

  expect(expired.state.write_enabled).toBe(false);
  expect(expired.state.resolve_enabled).toBe(true);
  expect(expired.state.branding_required).toBe(true);
  expect(expired.writeCode).toBe("LicenseWriteDenied");
  expect(expired.badgeCount).toBe(1);

  await page.evaluate(async () => {
    await window.__d4_signed_lfe.close();
  });
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(0);
});
