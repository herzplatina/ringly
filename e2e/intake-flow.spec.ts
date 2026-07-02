import { test, expect, type Route } from "@playwright/test";

const ENRICHED = {
  found: true,
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
  hours: Array.from({ length: 7 }, (_, d) => ({
    day_of_week: d,
    is_closed: d === 0,
    hours_ranges: d === 0 ? [] : [{ open: "09:00", close: "17:00" }],
  })),
  services: [
    {
      name: "Haircut",
      description: "",
      price_cents: 4500,
      duration_minutes: 60,
    },
  ],
};

test.describe("conversational intake (v2 onboarding)", () => {
  test("enriches free text into an editable review with a setup CTA", async ({
    page,
  }) => {
    await page.route("**/api/enrich", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ENRICHED),
      }),
    );

    await page.goto("/");
    await page
      .getByLabel("Business name and address")
      .fill("Glamour Studio, Austin");
    await page.getByRole("button", { name: "Continue" }).click();

    // Welcome + enriched, inline-editable fields prefilled.
    await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();
    await expect(page.getByLabel("Address")).toHaveValue(
      "123 Main St, Austin, TX",
    );
    await expect(page.getByLabel("Timezone")).toHaveValue("America/Chicago");
    await expect(page.getByLabel("Service 1 name")).toHaveValue("Haircut");

    // Editing a field works.
    const nameField = page.getByLabel("Business name");
    await nameField.fill("Glamour Studio & Spa");
    await expect(nameField).toHaveValue("Glamour Studio & Spa");

    // The setup CTA is present (clicking it would start Google OAuth).
    await expect(
      page.getByRole("button", { name: "Set up your AI Receptionist" }),
    ).toBeVisible();
  });

  test("offers candidate disambiguation when the match is ambiguous", async ({
    page,
  }) => {
    await page.route("**/api/enrich", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          found: true,
          candidates: [
            {
              place_id: "a",
              name: "Glamour Studio Downtown",
              address: "1 A St",
            },
            { place_id: "b", name: "Glamour Studio North", address: "2 B St" },
          ],
        }),
      }),
    );

    await page.goto("/");
    await page.getByLabel("Business name and address").fill("Glamour Studio");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Which one is yours?")).toBeVisible();
    await expect(page.getByText("Glamour Studio Downtown")).toBeVisible();
    await expect(page.getByText("Glamour Studio North")).toBeVisible();
  });
});
