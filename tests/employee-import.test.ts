import {describe,expect,it} from "vitest";
import {previewEmployeeCsv} from "../lib/workforce/employee-import";

const header="first_name,last_name,email,phone,language,contract_type,contracted_hours,hourly_cost,department,role";

describe("employee CSV import",()=>{
  it("normalizes valid rows without writing authoritative data",()=>{
    const result=previewEmployeeCsv(`${header}\nSophie,Jansen,sophie@example.com,06 12345678,nl,employee,24,19.50,Bars,Bartender`);
    expect(result.rejected).toEqual([]);
    expect(result.accepted[0]).toMatchObject({phone:"+31612345678",contractedMinutesWeek:1440,hourlyCostMinor:1950n});
  });
  it("explains invalid and in-file duplicate rows individually",()=>{
    const result=previewEmployeeCsv(`${header}\nSophie,Jansen,sophie@example.com,0612345678,nl,employee,24,19.50,Bars,Bartender\nSophie,Jansen,sophie@example.com,0612345678,nl,employee,24,19.50,Bars,Bartender\nBad,Email,nope,,nl,employee,24,19.50,Bars,Bartender`);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected.map(row=>row.code)).toEqual(["DUPLICATE_IN_FILE","INVALID_EMAIL"]);
  });
});
