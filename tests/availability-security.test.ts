import {describe,expect,it} from "vitest";
import {AVAILABILITY_TOKEN_BYTES,createAvailabilityToken,hashAvailabilityToken,validateAvailabilityEntries} from "../lib/workforce/availability";

describe("availability request security",()=>{
  it("creates 256-bit URL-safe single-purpose tokens",()=>{
    const first=createAvailabilityToken(),second=createAvailabilityToken();
    expect(AVAILABILITY_TOKEN_BYTES).toBe(32);
    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(hashAvailabilityToken(first)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects malformed tokens",()=>expect(()=>hashAvailabilityToken("short")).toThrow());
  it("rejects overlapping and out-of-period ranges",()=>{
    const periodStart="2026-08-01T00:00:00Z",periodEnd="2026-08-08T00:00:00Z";
    expect(validateAvailabilityEntries([{startsAt:"2026-08-01T10:00:00Z",endsAt:"2026-08-01T18:00:00Z",availability:"available"}],periodStart,periodEnd)).toHaveLength(1);
    expect(()=>validateAvailabilityEntries([
      {startsAt:"2026-08-01T10:00:00Z",endsAt:"2026-08-01T18:00:00Z",availability:"available"},
      {startsAt:"2026-08-01T17:00:00Z",endsAt:"2026-08-01T20:00:00Z",availability:"unavailable"},
    ],periodStart,periodEnd)).toThrow();
  });
});
