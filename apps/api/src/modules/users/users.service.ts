import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthRepository, AuthUserRecord } from "../auth/auth.types.js";

export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRecord["role"];
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: number;
  status: AuthUserRecord["status"];
}

@Injectable()
export class UsersService {
  constructor(@Inject("AuthRepository") private readonly authRepository: AuthRepository) {}

  async getMe(userId: string): Promise<UserProfileResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    return this.toProfileResponse(user);
  }

  async updateMe(userId: string, input: { fullName?: string; classLevel?: number }): Promise<UserProfileResponse> {
    const updatedUser = await this.authRepository.updateUserProfile(userId, input);
    if (!updatedUser) throw new NotFoundException("User not found.");
    return this.toProfileResponse(updatedUser);
  }

  async updateMyUniversity(
    userId: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<UserProfileResponse> {
    const updatedUser = await this.authRepository.updateUserAcademicSelection(userId, input);
    if (!updatedUser) throw new NotFoundException("User not found.");
    return this.toProfileResponse(updatedUser);
  }

  private toProfileResponse(user: AuthUserRecord): UserProfileResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      ...(user.universityId ? { universityId: user.universityId } : {}),
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      ...(user.classLevel ? { classLevel: user.classLevel } : {}),
      status: user.status
    };
  }
}
