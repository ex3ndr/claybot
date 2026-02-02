import { describe, it, expect } from "vitest";

import { permissionAccessParse } from "./permissionAccessParse.js";

describe("permissionAccessParse", () => {
  it("parses @web", () => {
    expect(permissionAccessParse("@web")).toEqual({ kind: "web" });
  });

  it("parses @read and @write paths", () => {
    expect(permissionAccessParse("@read:/tmp")).toEqual({ kind: "read", path: "/tmp" });
    expect(permissionAccessParse("@write:/var/log")).toEqual({ kind: "write", path: "/var/log" });
  });

  it("rejects invalid tags", () => {
    expect(() => permissionAccessParse("read:/tmp")).toThrow("Permission must be");
  });
});
