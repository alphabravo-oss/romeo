import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  sanitizeCsvFilename,
  serializeTableCsv,
} from "./table-csv";

describe("table CSV serialization", () => {
  it.each([
    [null, ""],
    [true, "true"],
    [42, "42"],
    ["comma,value", '"comma,value"'],
    ['quote"value', '"quote""value"'],
    ["two\nlines", '"two\nlines"'],
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+cmd", "'+cmd"],
    ["-1+2", "'-1+2"],
    ["@formula", "'@formula"],
    [new Date("2026-07-29T12:00:00.000Z"), "2026-07-29T12:00:00.000Z"],
    [{ unsafe: true }, ""],
  ])("serializes %j safely", (value, expected) => {
    expect(escapeCsvCell(value)).toBe(expected);
  });

  it("serializes columns and records with CRLF rows", () => {
    expect(
      serializeTableCsv(
        [
          { header: "Name", value: (row: { name: string }) => row.name },
          { header: "Enabled", value: () => true },
        ],
        [{ name: "Romeo, Inc." }],
      ),
    ).toBe('Name,Enabled\r\n"Romeo, Inc.",true');
  });

  it("sanitizes CSV download filenames", () => {
    expect(sanitizeCsvFilename("../../users:active")).toBe("users-active.csv");
    expect(sanitizeCsvFilename("report.csv")).toBe("report.csv");
    expect(sanitizeCsvFilename("\u0000")).toBe("romeo-table.csv");
  });
});
