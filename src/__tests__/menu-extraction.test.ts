import {
  capServices,
  htmlToText,
  fetchWebsiteText,
  extractServicesFromUrl,
} from "@/lib/menu-extraction";

const svc = (name: string) => ({
  name,
  description: "",
  price_cents: null,
  duration_minutes: null,
});

describe("capServices", () => {
  test("caps auto-extracted menus at 5 by default", () => {
    const many = Array.from({ length: 9 }, (_, i) => svc(`s${i}`));
    expect(capServices(many)).toHaveLength(5);
    expect(capServices(many).map((s) => s.name)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
  });
  test("leaves shorter lists untouched", () => {
    const few = [svc("a"), svc("b")];
    expect(capServices(few)).toHaveLength(2);
  });
});

describe("htmlToText", () => {
  test("strips tags, scripts, and styles and collapses whitespace", () => {
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body><script>alert(1)</script>
      <h1>Haircut</h1>   <p>$45&nbsp;&mdash; 60 min</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Haircut");
    expect(text).toContain("$45");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toMatch(/<[^>]+>/);
  });
});

describe("fetchWebsiteText (bounded crawl)", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test("returns extracted text on a successful fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => "<h1>Haircut $45</h1>",
    }) as unknown as typeof fetch;
    expect(await fetchWebsiteText("https://x.example")).toContain(
      "Haircut $45",
    );
  });

  test("returns '' on a non-OK response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => "nope",
    }) as unknown as typeof fetch;
    expect(await fetchWebsiteText("https://x.example")).toBe("");
  });

  test("returns '' when the fetch aborts/times out (rejects)", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("aborted")) as unknown as typeof fetch;
    expect(await fetchWebsiteText("https://x.example")).toBe("");
  });
});

describe("extractServicesFromUrl", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test("returns [] without calling the model when the site yields no text", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    // No ANTHROPIC key / network needed — empty text short-circuits.
    expect(await extractServicesFromUrl("https://x.example")).toEqual([]);
  });
});
