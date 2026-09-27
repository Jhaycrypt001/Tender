/**
 * Writes the OpenAPI document to docs/openapi.json, for readers without a
 * running server (and for tools that import a spec file).
 *
 *   npm run openapi:export
 *
 * test/openapi.test.ts fails if the file is out of date.
 */
import { writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/openapi.js";

const path = new URL("../docs/openapi.json", import.meta.url);
writeFileSync(path, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
console.log(`wrote ${path.pathname}`);
