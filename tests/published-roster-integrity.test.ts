import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const route=readFileSync("app/api/planning/route.ts","utf8");

describe("published roster integrity",()=>{
  it("keeps ordinary edit, cancel and lock mutations draft-only",()=>{
    const draftGuards=route.match(/\.eq\("status","draft"\)/g)??[];
    expect(draftGuards.length).toBeGreaterThanOrEqual(3);
  });
  it("routes affected published shifts through the governed successor RPC",()=>{
    expect(route).toContain("replace_published_shift_segments");
    expect(route).toContain("target_expected_revision");
    expect(route).toContain("target_idempotency_key");
  });
});
