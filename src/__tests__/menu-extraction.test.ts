import { capServices, htmlToText } from "@/lib/menu-extraction";

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
