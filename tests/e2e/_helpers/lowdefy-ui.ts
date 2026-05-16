// tests/e2e/_helpers/lowdefy-ui.ts
//
// Reusable Playwright locator helpers for UI-driven mutation specs against the
// Lowdefy 5.3 SSR runtime. Centralizes the two derivations every Phase 03 spec
// would otherwise re-discover:
//
//   1. LOCATOR STRATEGY (origin: .planning/phases/03-availability-rules/03-RESEARCH.md
//      §"Test strategy Pattern A"). Lowdefy emits every YAML block's `id:` value
//      verbatim as the HTML `id` attribute on the rendered Ant component. So:
//        - Form input  → page.locator(`[id="${blockId}"]`).fill(value)
//        - Button      → page.getByRole('button', { name: hebrewLabel })
//        - AgGrid cell → page.locator('.ag-cell').filter({ hasText: text })
//        - Switch      → page.locator(`[id="${blockId}"] .ant-switch`).click()
//        - Selector    → click the [id="..."] then click the dropdown option by text
//
//   2. COOKIE PROTOCOL (origin: .planning/phases/02-org-people/02-11-SUMMARY.md
//      closeout). NextAuth uses the `__Secure-` prefix on the session-token cookie
//      name when NEXTAUTH_URL begins with `https://` (the hpg5 deployment via
//      apps.nesher.co). The Cookie header sent by tests must match that name even
//      when the test traffic itself goes over plain HTTP — Cloudflare Tunnel
//      terminates HTTPS upstream; the container side sees HTTP but Auth.js still
//      uses secure-cookie naming based on the configured NEXTAUTH_URL.
//        HTTPS BASE_URL → name '__Secure-next-auth.session-token', secure: true
//        HTTP  BASE_URL → name 'next-auth.session-token',          secure: false
//
// Rationale for one consolidated helper file: every Phase 03 UI-driven mutation
// spec (and the rebuilt Phase 02 specs) imports from this file. Centralizing the
// pattern here prevents the Phase 02 mistake from replaying — each spec author
// would otherwise re-derive locators against the YAML and miss subtleties like
// Modal-scoped block IDs or the AgGrid `.ag-cell` filter.

import { expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Fill a Lowdefy TextInput / TextArea / NumberInput by its YAML block id.
 *
 * The block id from YAML (e.g. `new_soldier_form.display_name`) becomes the
 * rendered Ant component's `id` attribute verbatim. Dots are preserved.
 *
 * @param page    Playwright Page
 * @param blockId The exact YAML `id:` of the input block
 * @param value   Value to fill
 */
export async function fillLowdefyInput(page: Page, blockId: string, value: string): Promise<void> {
  await page.locator(`[id="${blockId}"]`).fill(value);
}

/**
 * Open the Ant Select dropdown owned by a Lowdefy Selector block and click an option by text.
 *
 * Lowdefy's `Selector` block renders as an Ant `<Select>` whose visible
 * `[id="<blockId>"]` element is the combobox trigger. Clicking it opens an
 * `.ant-select-dropdown` overlay; we filter the visible item by its text.
 *
 * @param page       Playwright Page
 * @param blockId    The Selector block's YAML id
 * @param optionText Visible text of the option to click (Hebrew or English)
 */
export async function selectLowdefyOption(
  page: Page,
  blockId: string,
  optionText: string,
): Promise<void> {
  // Click trigger to open dropdown
  await page.locator(`[id="${blockId}"]`).click();
  // The dropdown attaches to body; filter the .ant-select-item by its text
  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: optionText })
    .first()
    .click();
}

/**
 * Toggle the Ant Switch inside a Lowdefy Switch block.
 *
 * @param page    Playwright Page
 * @param blockId The Switch block's YAML id
 */
export async function toggleLowdefySwitch(page: Page, blockId: string): Promise<void> {
  await page.locator(`[id="${blockId}"] .ant-switch`).click();
}

/**
 * Click an Ant Button by its visible label.
 *
 * Lowdefy `Button` blocks set `title` (the Hebrew label) on the rendered Ant button.
 * Playwright's `getByRole('button', { name })` matches the accessible name, which
 * for Ant buttons is the button text — Hebrew labels match verbatim.
 *
 * @param page        Playwright Page
 * @param hebrewLabel Exact visible label as it appears in the YAML `title:`
 */
export async function clickLowdefyButton(page: Page, hebrewLabel: string): Promise<void> {
  await page.getByRole('button', { name: hebrewLabel }).first().click();
}

/**
 * Assert an AgGrid cell containing the given text is visible.
 *
 * Use this after a mutation to confirm the new/updated row surfaces in the grid.
 * The `.ag-cell` selector is part of AgGrid's stable DOM contract.
 *
 * @param page    Playwright Page
 * @param text    Substring expected to appear in at least one grid cell
 */
export async function expectAgGridCellText(page: Page, text: string): Promise<void> {
  await expect(page.locator('.ag-cell').filter({ hasText: text }).first()).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Wait for an Ant `Notification` / `Message` toast with the given content.
 *
 * Lowdefy's `DisplayMessage` action renders as an Ant `message`, which mounts under
 * `.ant-message-notice` (top-of-viewport). Ant `notification` uses `.ant-notification-notice`.
 * We tolerate either.
 *
 * @param page      Playwright Page
 * @param message   Substring of the toast text
 * @param timeoutMs How long to wait (default 5000ms)
 */
export async function expectLowdefyNotification(
  page: Page,
  message: string,
  timeoutMs = 5000,
): Promise<void> {
  const toastLocator = page
    .locator('.ant-message-notice, .ant-notification-notice')
    .filter({ hasText: message })
    .first();
  await expect(toastLocator).toBeVisible({ timeout: timeoutMs });
}

/**
 * Add the NextAuth session-token cookie to the BrowserContext, picking the right
 * cookie name + `secure` flag based on the BASE_URL protocol.
 *
 * HTTPS BASE_URL (e.g. https://apps.nesher.co) → '__Secure-next-auth.session-token', secure: true
 * HTTP  BASE_URL (e.g. http://hpg5:8080)       → 'next-auth.session-token',          secure: false
 *
 * @param context      The BrowserContext (from `page.context()`)
 * @param sessionToken The token returned by `signInAs(...)`
 * @param baseUrl      The PLAYWRIGHT_BASE_URL value
 */
export async function setSessionCookie(
  context: BrowserContext,
  sessionToken: string,
  baseUrl: string,
): Promise<void> {
  const isHttps = baseUrl.startsWith('https://');
  const cookieName = isHttps
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';
  await context.addCookies([
    {
      name: cookieName,
      value: sessionToken,
      url: baseUrl,
      httpOnly: true,
      secure: isHttps,
      sameSite: 'Lax',
    },
  ]);
}
