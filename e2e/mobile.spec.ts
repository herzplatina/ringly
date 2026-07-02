import { test, expect, type Route } from "@playwright/test";

// iPhone-ish viewport
test.use({ viewport: { width: 375, height: 812 } });

test.describe("mobile form factor", () => {
  test("intake fits the viewport with no horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Business name and address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1); // no sideways scroll
  });

  test("dashboard collapses the sidebar into a hamburger drawer", async ({
    page,
  }) => {
    await page.route("**/auth/v1/**", (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "u1", email: "o@x.com" },
          access_token: "t",
        }),
      }),
    );
    await page.route("**/rest/v1/**", (r: Route) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route("/api/business", (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "b1",
          name: "Test Biz",
          retell_phone_number: "+15125550100",
          whatsapp_sender_status: "approved",
        }),
      }),
    );
    await page.route(
      /\/api\/(appointments|calls|customers|services|hours)/,
      (r: Route) =>
        r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    await page.goto("/dashboard");

    // Mobile: hamburger visible, static nav collapsed off-canvas.
    const burger = page.getByRole("button", { name: "Open menu" });
    await expect(burger).toBeVisible();

    // Opening the drawer reveals the nav links.
    await burger.click();
    await expect(
      page.getByRole("link", { name: "Appointments" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

    // No horizontal overflow on the dashboard either.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
