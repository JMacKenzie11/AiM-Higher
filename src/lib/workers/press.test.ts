import { describe, it, expect } from "vitest";
import { checkEnter, checkPress, domainOf, ruleCovers, type PressTarget } from "./press";

const button = (text: string, over: Partial<PressTarget> = {}): PressTarget => ({
  tag: "button",
  type: "submit",
  role: "",
  text,
  href: null,
  inForm: true,
  searchForm: false,
  ...over,
});

describe("checkPress", () => {
  it("lets reading, searching and signing in go without asking", () => {
    expect(checkPress(button("Search"))).toBeNull();
    expect(checkPress(button("Sign in"))).toBeNull();
    expect(checkPress(button("Go", { searchForm: true }))).toBeNull();
    expect(checkPress(button("Next", { type: "button", inForm: false }))).toBeNull();
    expect(checkPress({ ...button("Running shoes"), tag: "a", type: "", href: "/shoes", inForm: false })).toBeNull();
  });

  it("asks before saving, sending or submitting", () => {
    expect(checkPress(button("Save changes"))).toEqual({ action: 'Press "Save changes"', alwaysAsks: false });
    expect(checkPress(button("Send"))).toMatchObject({ alwaysAsks: false });
    expect(checkPress(button(""))).toEqual({ action: 'Press "Submit"', alwaysAsks: false });
    expect(checkPress(button("Add to cart", { type: "button", inForm: false }))).toMatchObject({ alwaysAsks: false });
  });

  it("always asks before paying, deleting, posting, access and terms", () => {
    for (const t of ["Place order", "Pay now", "Checkout", "Delete invoice", "Post", "Publish", "Grant access", "I agree to the terms", "Subscribe"]) {
      expect(checkPress(button(t))?.alwaysAsks, t).toBe(true);
    }
    expect(checkPress({ ...button("Delete account"), tag: "a", type: "", href: "/delete", inForm: false })?.alwaysAsks).toBe(true);
  });

  it("lets a cookie banner's Accept go", () => {
    expect(checkPress(button("Accept cookies", { type: "button", inForm: false }))).toBeNull();
  });

  it("leaves a plain element alone", () => {
    expect(checkPress({ ...button("Price"), tag: "div", type: "", inForm: false })).toBeNull();
  });
});

describe("checkEnter", () => {
  const field = { ...button(""), tag: "input", type: "text", submitText: "Save" as string | null };

  it("asks when Enter would submit a form", () => {
    expect(checkEnter(field)).toEqual({ action: 'Press "Save"', alwaysAsks: false });
    expect(checkEnter({ ...field, submitText: null })).toMatchObject({ action: 'Press "Submit the form"' });
  });

  it("lets a search box and a text area go", () => {
    expect(checkEnter({ ...field, searchForm: true })).toBeNull();
    expect(checkEnter({ ...field, tag: "textarea" })).toBeNull();
    expect(checkEnter({ ...field, inForm: false })).toBeNull();
  });
});

describe("domains", () => {
  it("reads a site's domain without www", () => {
    expect(domainOf("https://www.Holabirdsports.com/search?q=x")).toBe("holabirdsports.com");
    expect(domainOf("about:blank")).toBe("");
  });

  it("covers subdomains", () => {
    expect(ruleCovers("example.com", "shop.example.com")).toBe(true);
    expect(ruleCovers("example.com", "example.com")).toBe(true);
    expect(ruleCovers("example.com", "badexample.com")).toBe(false);
  });
});
