import { test, expect, type Route } from "@playwright/test";

const DRAFT = {
  business: {
    google_place_id: "p1",
    name: "Glamour Studio",
    formatted_address: "123 Main St, Austin, TX",
    public_phone: "+15125550100",
    website_url: "https://glamour.example",
    timezone: "America/Chicago",
    latitude: 30.26,
    longitude: -97.74,
  },
  hours: [],
  services: [],
};

test.describe("onboarding finish (claim -> provision -> live)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/business/claim", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ businessId: "biz-1" }),
      }),
    );
    await page.route("**/api/retell/provision", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, phone_number: "+15125550123" }),
      }),
    );
    // Seed the pre-auth draft the intake screen would have saved.
    await page.addInitScript((draft) => {
      window.sessionStorage.setItem("ringly_draft", JSON.stringify(draft));
    }, DRAFT);
  });

  test("provisions and shows the number, then reveals the live call screen", async ({
    page,
  }) => {
    await page.goto("/onboarding/finish");

    // Success screen with the formatted new number.
    await expect(
      page.getByRole("heading", { name: /receptionist is ready/i }),
    ).toBeVisible();
    await expect(page.getByText("(512) 555-0123")).toBeVisible();

    // Go Live → call screen.
    await page.getByRole("button", { name: "Go Live" }).click();
    await expect(
      page.getByRole("heading", { name: /You're live/i }),
    ).toBeVisible();
    await expect(page.getByText("(512) 555-0123")).toBeVisible();
  });

  test("surfaces an error if provisioning fails", async ({ page }) => {
    await page.route("**/api/retell/provision", (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Provisioning failed. Please retry." }),
      }),
    );
    await page.goto("/onboarding/finish");
    await expect(
      page.getByRole("heading", { name: /Something went wrong/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
