import { BadRequestException } from "@nestjs/common";
import type { DepartmentRecord } from "./catalog.types.js";

export interface ClassLevelOption {
  value: number;
  label: string;
}

export function maxClassLevelForDepartment(department?: Pick<DepartmentRecord, "name" | "educationLevel"> | null): number {
  if (!department) return 4;
  if (department.educationLevel === "associate") return 2;
  if (department.educationLevel === "master") return 2;
  if (department.educationLevel === "doctorate") return 4;
  if (department.educationLevel === "bachelor") return maxBachelorClassLevel(department.name);
  return 4;
}

export function classLevelOptionsForDepartment(department?: Pick<DepartmentRecord, "name" | "educationLevel"> | null): ClassLevelOption[] {
  return Array.from({ length: maxClassLevelForDepartment(department) }, (_, index) => {
    const value = index + 1;
    return { value, label: `${value}. sınıf` };
  });
}

export function assertClassLevelAllowed(classLevel: number | undefined, department?: Pick<DepartmentRecord, "name" | "educationLevel"> | null): void {
  if (classLevel === undefined) return;
  const maxClassLevel = maxClassLevelForDepartment(department);
  if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > maxClassLevel) {
    throw new BadRequestException(`Sınıf seviyesi seçilen program için 1-${maxClassLevel} arasında olmalıdır.`);
  }
}

function maxBachelorClassLevel(departmentName: string): number {
  const name = foldForMatch(departmentName);
  if (/\b(tip|medicine)\b/u.test(name)) return 6;
  if (/\b(dis hekimligi|eczacilik|veteriner|veterinerlik|dentistry|pharmacy|veterinary)\b/u.test(name)) return 5;
  return 4;
}

function foldForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
