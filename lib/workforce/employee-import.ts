import { detectDelimiter, parseCsvLine } from "../imports/pos-csv";
import { normalizeDutchPhone } from "./domain";

export type EmployeeImportRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredLanguage: "nl" | "en";
  contractType: "employee" | "contractor" | "temporary";
  contractedMinutesWeek: number;
  hourlyCostMinor: bigint;
  department: string;
  role: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const integerMinor = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("INVALID_HOURLY_COST");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};

export function previewEmployeeCsv(source: string) {
  if (source.length > 2_000_000) throw new Error("EMPLOYEE_IMPORT_TOO_LARGE");
  const delimiter = detectDelimiter(source);
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] ?? "", delimiter).map((header) => header.toLowerCase());
  const required = ["first_name", "last_name", "email", "language", "contract_type", "contracted_hours", "hourly_cost", "department", "role"];
  for (const name of required) if (!headers.includes(name)) throw new Error(`MISSING_${name.toUpperCase()}`);
  const cell = (cells: string[], name: string) => cells[headers.indexOf(name)]?.trim() ?? "";
  const accepted: EmployeeImportRow[] = [];
  const rejected: { rowNumber: number; code: string; message: string }[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const rowNumber = index + 1;
    try {
      const cells = parseCsvLine(lines[index], delimiter);
      const firstName = cell(cells, "first_name");
      const lastName = cell(cells, "last_name");
      const email = cell(cells, "email").toLowerCase();
      if (!firstName || !lastName) throw new Error("NAME_REQUIRED");
      if (!emailPattern.test(email)) throw new Error("INVALID_EMAIL");
      const rawPhone = cell(cells, "phone");
      const phone = rawPhone ? normalizeDutchPhone(rawPhone) : null;
      const preferredLanguage = cell(cells, "language").toLowerCase();
      if (preferredLanguage !== "nl" && preferredLanguage !== "en") throw new Error("INVALID_LANGUAGE");
      const contractType = cell(cells, "contract_type").toLowerCase();
      if (!["employee", "contractor", "temporary"].includes(contractType)) throw new Error("INVALID_CONTRACT_TYPE");
      const hours = cell(cells, "contracted_hours").replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(hours)) throw new Error("INVALID_CONTRACTED_HOURS");
      const contractedMinutesWeek = Math.round(Number(hours) * 60);
      if (contractedMinutesWeek < 0 || contractedMinutesWeek > 10_080) throw new Error("INVALID_CONTRACTED_HOURS");
      const duplicateKey = `${email}|${phone ?? ""}`;
      if (seen.has(duplicateKey)) throw new Error("DUPLICATE_IN_FILE");
      seen.add(duplicateKey);
      const department=cell(cells,"department"),role=cell(cells,"role");
      if(!department||!role)throw new Error("DEPARTMENT_ROLE_REQUIRED");
      accepted.push({
        rowNumber, firstName, lastName, email, phone,
        preferredLanguage,
        contractType: contractType as EmployeeImportRow["contractType"],
        contractedMinutesWeek,
        hourlyCostMinor: integerMinor(cell(cells, "hourly_cost")),
        department, role,
      });
    } catch (error) {
      rejected.push({rowNumber,code:error instanceof Error?error.message:"INVALID_ROW",message:"This row was not written. Correct it or explicitly exclude it before import."});
    }
  }
  return {delimiter,headers,accepted,rejected};
}
