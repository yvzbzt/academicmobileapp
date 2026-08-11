import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthRepository, AuthUserRecord } from "../auth/auth.types.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import type { NotificationRepository } from "../notifications/notification.types.js";
import type { AnnouncementRepository } from "../announcements/announcements.types.js";
import { assertClassLevelAllowed, classLevelOptionsForDepartment } from "../catalog/academic-levels.js";
import {
  normalizeFollowedAcademicScope,
  type AcademicUnitSuggestionRecord,
  type FollowedAcademicScopeRecord,
  type UserDataRepository
} from "./user-data.types.js";

export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRecord["role"];
  authProvider?: AuthUserRecord["authProvider"];
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: number;
  status: AuthUserRecord["status"];
  createdAt?: string;
  updatedAt?: string;
  emailVerifiedAt?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject("UserDataRepository") private readonly userDataRepository: UserDataRepository,
    @Optional() @Inject("NotificationRepository") private readonly notificationRepository?: NotificationRepository,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository
  ) {}

  async getMe(userId: string): Promise<UserProfileResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    return this.toProfileResponse(user);
  }

  async getAffiliationOptions(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    const domain = emailDomain(user.email);
    const university = domain ? await this.catalogRepository.findUniversityByEmailDomain(domain) : null;
    if (!university || university.status !== "active") {
      return { emailDomain: domain, university: null, faculties: [], departments: [], classLevelOptions: classLevelOptionsForDepartment(null), needsUniversityReview: Boolean(domain?.includes(".edu")) };
    }

    const faculties = await this.catalogRepository.listFaculties(university.id, "active");
    const departments = await Promise.all(faculties.map((faculty) => this.catalogRepository.listDepartments(faculty.id, "active")));
    const selectedDepartment = user.departmentId ? departments.flat().find((department) => department.id === user.departmentId) : null;
    return { emailDomain: domain, university, faculties, departments: departments.flat(), classLevelOptions: classLevelOptionsForDepartment(selectedDepartment), needsUniversityReview: false };
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit?: number; offset?: number }): Promise<UserProfileResponse[]> {
    const users = await this.authRepository.listUsers({
      ...(input.search ? { search: input.search } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit ?? 50,
      offset: input.offset ?? 0
    });
    return users.map((user) => this.toProfileResponse(user));
  }

  async updateUserByAdmin(
    userId: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<UserProfileResponse> {
    const current = await this.authRepository.findUserById(userId);
    if (!current) throw new NotFoundException("User not found.");
    const hasUniversity = Object.prototype.hasOwnProperty.call(input, "universityId");
    const hasFaculty = Object.prototype.hasOwnProperty.call(input, "facultyId");
    const hasDepartment = Object.prototype.hasOwnProperty.call(input, "departmentId");
    const hasClassLevel = Object.prototype.hasOwnProperty.call(input, "classLevel");
    const updatesAcademicSelection = hasUniversity || hasFaculty || hasDepartment || hasClassLevel;
    const requestedUniversityId = input.universityId?.trim() || undefined;
    const requestedFacultyId = input.facultyId?.trim() || undefined;
    const requestedDepartmentId = input.departmentId?.trim() || undefined;
    let updatedUser: AuthUserRecord | null = current;

    if (hasUniversity && !requestedUniversityId) {
      throw new BadRequestException("University is required when updating academic selection.");
    }

    if (updatesAcademicSelection) {
      const universityId = hasUniversity ? requestedUniversityId : current.universityId;
      const universityChanged = hasUniversity && universityId !== current.universityId;
      const facultyId = hasFaculty
        ? requestedFacultyId
        : universityChanged
          ? undefined
          : current.facultyId;
      const facultyChanged = universityChanged || (hasFaculty && facultyId !== current.facultyId);
      const departmentId = hasDepartment
        ? requestedDepartmentId
        : facultyChanged
          ? undefined
          : current.departmentId;
      const departmentChanged = facultyChanged || (hasDepartment && departmentId !== current.departmentId);
      const classLevel = hasClassLevel
        ? input.classLevel
        : departmentChanged
          ? undefined
          : current.classLevel;

      if (universityId) {
        const selection = {
          universityId,
          ...(facultyId ? { facultyId } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(classLevel !== undefined ? { classLevel } : {})
        };
        await this.validateAcademicSelection(selection);
        updatedUser = await this.authRepository.updateUserAcademicSelection(userId, selection);
      } else {
        if (facultyId || departmentId) throw new BadRequestException("University is required for academic selection.");
        assertClassLevelAllowed(classLevel, null);
        updatedUser = await this.authRepository.updateUserByAdmin(userId, {
          ...(classLevel !== undefined ? { classLevel } : {})
        });
      }
    }

    const {
      universityId: _universityId,
      facultyId: _facultyId,
      departmentId: _departmentId,
      classLevel: _classLevel,
      ...nonAcademicInput
    } = input;
    if (Object.keys(nonAcademicInput).length > 0) {
      updatedUser = await this.authRepository.updateUserByAdmin(userId, nonAcademicInput);
    }
    if (!updatedUser) throw new NotFoundException("User not found.");
    return this.toProfileResponse(updatedUser);
  }

  async deleteUserByAdmin(userId: string): Promise<{ status: "deleted" }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    await this.notificationRepository?.deleteUserData(userId);
    await this.announcementRepository?.deleteSavedAnnouncementsByUserId(userId);
    await this.userDataRepository.deleteUserData(userId);
    await this.authRepository.deleteUserByAdmin(userId);
    return { status: "deleted" };
  }

  async deleteMyData(userId: string): Promise<{ status: "deleted" }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    await this.notificationRepository?.deleteUserData(userId);
    await this.announcementRepository?.deleteSavedAnnouncementsByUserId(userId);
    await this.userDataRepository.deleteUserData(userId);
    await this.authRepository.clearUserAppData(userId);
    return { status: "deleted" };
  }

  async deleteMe(userId: string, input: { deleteData?: boolean } = {}): Promise<{ status: "deleted" }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");

    if (input.deleteData !== false) {
      await this.deleteMyData(userId);
    } else {
      await this.notificationRepository?.deleteUserData(userId);
      await this.announcementRepository?.deleteSavedAnnouncementsByUserId(userId);
      await this.userDataRepository.deleteUserData(userId);
    }

    const deletedAt = new Date();
    await this.authRepository.revokeRefreshTokensByUserId(userId, deletedAt);
    await this.authRepository.deleteEmailVerificationTokensByUserId(userId);
    await this.authRepository.deletePasswordRecoveryTokensByUserId(userId);
    await this.authRepository.deleteUserAccount(userId, {
      deletedAt,
      anonymizedEmail: `deleted-${userId}-${randomUUID()}@deleted.local`,
      anonymizedFullName: "Deleted User",
      anonymizedPasswordHash: `deleted:${randomUUID()}`
    });
    return { status: "deleted" };
  }

  async listUnassociatedEmailDomains(): Promise<Array<{ domain: string; userCount: number; sampleEmails: string[] }>> {
    const users = await this.authRepository.listUsers({ limit: 500, offset: 0 });
    const grouped = new Map<string, string[]>();
    for (const user of users) {
      const domain = emailDomain(user.email);
      if (!domain || !domain.includes(".edu")) continue;
      const university = await this.catalogRepository.findUniversityByEmailDomain(domain);
      if (university) continue;
      grouped.set(domain, [...(grouped.get(domain) ?? []), user.email]);
    }

    return [...grouped.entries()]
      .map(([domain, emails]) => ({ domain, userCount: emails.length, sampleEmails: emails.slice(0, 5) }))
      .sort((left, right) => right.userCount - left.userCount || left.domain.localeCompare(right.domain));
  }


  async updateMe(userId: string, input: { fullName?: string; classLevel?: number }): Promise<UserProfileResponse> {
    if (input.classLevel !== undefined) {
      const user = await this.authRepository.findUserById(userId);
      if (!user) throw new NotFoundException("User not found.");
      if (user.universityId) await this.validateAcademicSelection({
        universityId: user.universityId,
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {}),
        classLevel: input.classLevel
      });
      else assertClassLevelAllowed(input.classLevel, null);
    }
    const updatedUser = await this.authRepository.updateUserProfile(userId, input);
    if (!updatedUser) throw new NotFoundException("User not found.");
    return this.toProfileResponse(updatedUser);
  }

  async updateMyUniversity(
    userId: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<UserProfileResponse> {
    await this.validateAcademicSelection(input);
    const updatedUser = await this.authRepository.updateUserAcademicSelection(userId, input);
    if (!updatedUser) throw new NotFoundException("User not found.");
    return this.toProfileResponse(updatedUser);
  }

  async suggestAcademicUnit(userId: string, input: { universityId: string; facultyName: string; departmentName?: string; educationLevel?: "associate" | "bachelor" | "master" | "doctorate" }) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university || university.status !== "active") throw new BadRequestException("University is not valid.");
    const suggestionInput = {
      userId,
      userEmail: user.email,
      universityId: input.universityId,
      facultyName: input.facultyName.trim(),
      ...(input.departmentName?.trim() ? { departmentName: input.departmentName.trim() } : {}),
      educationLevel: input.educationLevel ?? "bachelor"
    };
    if (suggestionInput.facultyName.length < 2) throw new BadRequestException("Faculty name is required.");
    const suggestion = await this.userDataRepository.createAcademicUnitSuggestion(suggestionInput);
    return this.toSuggestionResponse(suggestion);
  }

  async listAcademicUnitSuggestions(status: "pending" | "approved" | "rejected" = "pending") {
    return (await this.userDataRepository.listAcademicUnitSuggestions(status))
      .map((suggestion) => this.toSuggestionResponse(suggestion));
  }

  async approveAcademicUnitSuggestion(id: string) {
    const suggestion = await this.userDataRepository.findAcademicUnitSuggestionById(id);
    if (!suggestion) throw new NotFoundException("Suggestion not found.");
    const faculty = await this.catalogRepository.createFaculty({
      universityId: suggestion.universityId,
      name: suggestion.facultyName,
      slug: slugify(suggestion.facultyName),
      status: "active"
    }).catch(async (error) => {
      if (String(error).includes("FACULTY_SLUG_EXISTS")) {
        const faculties = await this.catalogRepository.listFaculties(suggestion.universityId, "active");
        const existing = faculties.find((faculty) => faculty.slug === slugify(suggestion.facultyName));
        if (existing) return existing;
      }
      throw error;
    });
    if (suggestion.departmentName) {
      await this.catalogRepository.createDepartment({
        universityId: suggestion.universityId,
        facultyId: faculty.id,
        name: suggestion.departmentName,
        slug: slugify(suggestion.departmentName),
        educationLevel: suggestion.educationLevel,
        status: "active"
      }).catch((error) => {
        if (!String(error).includes("DEPARTMENT_SLUG_EXISTS")) throw error;
      });
    }
    const reviewed = await this.userDataRepository.updateAcademicUnitSuggestionReview(id, {
      status: "approved",
      reviewedAt: new Date()
    });
    if (!reviewed) throw new NotFoundException("Suggestion not found.");
    return this.toSuggestionResponse(reviewed);
  }

  async rejectAcademicUnitSuggestion(id: string) {
    const reviewed = await this.userDataRepository.updateAcademicUnitSuggestionReview(id, {
      status: "rejected",
      reviewedAt: new Date()
    });
    if (!reviewed) throw new NotFoundException("Suggestion not found.");
    return this.toSuggestionResponse(reviewed);
  }

  async listFollowedScopes(userId: string) {
    return (await this.userDataRepository.listFollowedAcademicScopesByUserId(userId))
      .map((scope) => this.toFollowedScopeResponse(scope));
  }

  async addFollowedScope(userId: string, input: { universityId: string; facultyId?: string; departmentId?: string }) {
    await this.validateAcademicSelection(input);
    const scope = await this.userDataRepository.upsertFollowedAcademicScope({
      userId,
      ...normalizeFollowedAcademicScope(input)
    });
    return this.toFollowedScopeResponse(scope);
  }

  private async validateAcademicSelection(input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<void> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university || university.status !== "active") throw new BadRequestException("University is not valid.");
    if (!input.facultyId && !input.departmentId) {
      assertClassLevelAllowed(input.classLevel, null);
      return;
    }
    if (!input.facultyId) throw new BadRequestException("Faculty is required when selecting a department.");
    const faculties = await this.catalogRepository.listFaculties(input.universityId, "active");
    const faculty = faculties.find((candidate) => candidate.id === input.facultyId);
    if (!faculty) throw new BadRequestException("Faculty is not valid for selected university.");
    if (!input.departmentId) {
      assertClassLevelAllowed(input.classLevel, null);
      return;
    }
    const departments = await this.catalogRepository.listDepartments(input.facultyId, "active");
    const department = departments.find((candidate) => candidate.id === input.departmentId && candidate.universityId === input.universityId);
    if (!department) throw new BadRequestException("Department is not valid for selected faculty.");
    assertClassLevelAllowed(input.classLevel, department);
  }

  private toSuggestionResponse(suggestion: AcademicUnitSuggestionRecord) {
    return {
      ...suggestion,
      createdAt: suggestion.createdAt.toISOString(),
      ...(suggestion.reviewedAt ? { reviewedAt: suggestion.reviewedAt.toISOString() } : {})
    };
  }

  private toFollowedScopeResponse(scope: FollowedAcademicScopeRecord) {
    return { ...scope, createdAt: scope.createdAt.toISOString() };
  }

  private toProfileResponse(user: AuthUserRecord): UserProfileResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      ...(user.authProvider ? { authProvider: user.authProvider } : {}),
      ...(user.universityId ? { universityId: user.universityId } : {}),
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      ...(user.classLevel ? { classLevel: user.classLevel } : {}),
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      ...(user.emailVerifiedAt ? { emailVerifiedAt: user.emailVerifiedAt.toISOString() } : {})
    };
  }
}

function emailDomain(email: string): string | undefined {
  return email.split("@")[1]?.toLocaleLowerCase("en-US");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
