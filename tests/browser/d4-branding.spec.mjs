import { expect, test } from "@playwright/test";

const BADGE_SELECTOR = "[data-planeslogic-lfe-lite-branding]";
const BADGE_TEXT = "Powered by PlanesLogic · LFE Lite";

test("D4 development lifecycle mounts one isolated branding badge and cleans it up", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");

  const initial = await page.evaluate(async ({ selector, text }) => {
    const { LfeLite } = await import("/dist/index.js");
    const first = await LfeLite.create();
    const state = await first.licenseState();

    const projected = await first.licenseState();
    projected.branding_required = false;
    const stateAgain = await first.licenseState();

    const host = document.querySelector(selector);
    const snapshot = {
      status: state.status,
      brandingRequired: state.branding_required,
      hostCount: document.querySelectorAll(selector).length,
      label: host?.getAttribute("aria-label"),
      closedShadowRoot: host?.shadowRoot === null,
      projectionIsReadOnly: stateAgain.branding_required === true,
      exactText: host?.getAttribute("aria-label") === text,
    };

    const second = await LfeLite.create();
    const twoRuntimeHostCount = document.querySelectorAll(selector).length;

    host?.remove();

    window.__d4_first = first;
    window.__d4_second = second;

    return { ...snapshot, twoRuntimeHostCount };
  }, { selector: BADGE_SELECTOR, text: BADGE_TEXT });

  expect(initial.status).toBe("DEVELOPMENT");
  expect(initial.brandingRequired).toBe(true);
  expect(initial.hostCount).toBe(1);
  expect(initial.label).toBe(BADGE_TEXT);
  expect(initial.closedShadowRoot).toBe(true);
  expect(initial.projectionIsReadOnly).toBe(true);
  expect(initial.exactText).toBe(true);
  expect(initial.twoRuntimeHostCount).toBe(1);

  await expect.poll(async () => page.locator(BADGE_SELECTOR).count()).toBe(1);

  await page.evaluate(async () => {
    await window.__d4_first.close();
  });
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(1);

  await page.evaluate(async () => {
    await window.__d4_second.close();
  });
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(0);
});
