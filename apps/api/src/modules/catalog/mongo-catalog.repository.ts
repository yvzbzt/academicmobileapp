import { Inject, Injectable } from "@nestjs/common";
import { departmentSchema, facultySchema, universitySchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { CatalogRepository, CatalogStatus, DepartmentRecord, FacultyRecord, UniversityRecord } from "./catalog.types.js";

@Injectable()
export class MongoCatalogRepository implements CatalogRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createUniversity(input: Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">): Promise<UniversityRecord> {
    const document = await (await this.model("University", universitySchema)).create(input);
    return toDomainRecord<UniversityRecord>(document);
  }

  async updateUniversity(id: string, input: Partial<Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">>): Promise<UniversityRecord | null> {
    const document = await (await this.model("University", universitySchema)).findByIdAndUpdate(id, omitUndefined(input), { new: true });
    return document ? toDomainRecord<UniversityRecord>(document) : null;
  }

  archiveUniversity(id: string): Promise<UniversityRecord | null> {
    return this.updateUniversity(id, { status: "archived" });
  }

  async findUniversityById(id: string): Promise<UniversityRecord | null> {
    const document = await (await this.model("University", universitySchema)).findById(id);
    return document ? toDomainRecord<UniversityRecord>(document) : null;
  }

  async listUniversities(input: { search?: string; status?: CatalogStatus; limit: number; offset: number }): Promise<UniversityRecord[]> {
    const query: Record<string, unknown> = { ...(input.status ? { status: input.status } : {}) };
    if (input.search) query.$or = [{ name: new RegExp(input.search, "i") }, { city: new RegExp(input.search, "i") }];
    const documents = await (await this.model("University", universitySchema)).find(query).sort({ name: 1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<UniversityRecord>(document));
  }

  async findUniversityByEmailDomain(domain: string): Promise<UniversityRecord | null> {
    const normalizedDomain = domain.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
    const document = await (await this.model("University", universitySchema)).findOne({ emailDomains: normalizedDomain });
    return document ? toDomainRecord<UniversityRecord>(document) : null;
  }

  async createFaculty(input: Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">): Promise<FacultyRecord> {
    const document = await (await this.model("Faculty", facultySchema)).create(input);
    return toDomainRecord<FacultyRecord>(document);
  }

  async updateFaculty(id: string, input: Partial<Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">>): Promise<FacultyRecord | null> {
    const document = await (await this.model("Faculty", facultySchema)).findByIdAndUpdate(id, omitUndefined(input), { new: true });
    return document ? toDomainRecord<FacultyRecord>(document) : null;
  }

  async listFaculties(universityId: string, status?: CatalogStatus): Promise<FacultyRecord[]> {
    const documents = await (await this.model("Faculty", facultySchema)).find({ universityId, ...(status ? { status } : {}) }).sort({ name: 1 });
    return documents.map((document) => toDomainRecord<FacultyRecord>(document));
  }

  async createDepartment(input: Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">): Promise<DepartmentRecord> {
    const document = await (await this.model("Department", departmentSchema)).create(input);
    return toDomainRecord<DepartmentRecord>(document);
  }

  async updateDepartment(id: string, input: Partial<Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">>): Promise<DepartmentRecord | null> {
    const document = await (await this.model("Department", departmentSchema)).findByIdAndUpdate(id, omitUndefined(input), { new: true });
    return document ? toDomainRecord<DepartmentRecord>(document) : null;
  }

  async listDepartments(facultyId: string, status?: CatalogStatus): Promise<DepartmentRecord[]> {
    const documents = await (await this.model("Department", departmentSchema)).find({ facultyId, ...(status ? { status } : {}) }).sort({ name: 1 });
    return documents.map((document) => toDomainRecord<DepartmentRecord>(document));
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}
