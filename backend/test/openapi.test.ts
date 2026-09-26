import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPERATIONS } from "../src/openapi.js";
import { setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
  await t.app.ready();
});
afterAll(() => teardown(t));

describe("Swagger / OpenAPI", () => {
  it("documents exactly the routes the API serves — no more, no fewer", () => {
    const served = [...new Set(t.app.apiRoutes)].sort();
    const documented = Object.keys(OPERATIONS).sort();
    expect(documented).toEqual(served);
  });

  it("serves the document and the UI", async () => {
    const doc = await t.app.inject({ method: "GET", url: "/docs/json" });
    expect(doc.statusCode).toBe(200);
    const body = doc.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths["/v1/invoices"].post.requestBody).toBeDefined();
    expect(body.paths["/public/invoices/{token}"].get.security).toEqual([]);
    expect(body.paths["/v1/merchant"].get.security).toEqual([{ merchantKey: [] }]);

    // A contract detail survives into the document: amounts are strings with the decimal pattern.
    const invoice = body.paths["/v1/invoices"].post.responses["201"].content["application/json"].schema;
    expect(invoice.properties.amount_expected.type).toBe("string");

    const ui = await t.app.inject({ method: "GET", url: "/docs/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.body).toContain("swagger");
  });
});
