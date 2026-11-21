import assert from "node:assert/strict";
import { changeStatus } from "./marketplace_watch.ts";

assert.equal(changeStatus("old-page", "new-page"), "changed");
assert.equal(changeStatus("same-page", "same-page"), "unchanged");
assert.equal(changeStatus(null, "first-page"), "unchanged");
console.log("seller page comparison keeps first capture quiet and alerts on a changed digest");
