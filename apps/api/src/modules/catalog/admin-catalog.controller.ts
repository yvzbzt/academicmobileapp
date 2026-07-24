import { Body, Controller, Delete, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { CatalogService } from "./catalog.service.js";
import { AddUniversityEmailDomainDto, CreateDepartmentDto, CreateFacultyDto, CreateUniversityDto, UpdateDepartmentDto, UpdateFacultyDto, UpdateUniversityDto } from "./catalog.dto.js";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class AdminCatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Post("universities")
  createUniversity(@Body() body: CreateUniversityDto) {
    return this.catalogService.createUniversity(body);
  }

  @Patch("universities/:id")
  updateUniversity(@Param("id") id: string, @Body() body: UpdateUniversityDto) {
    return this.catalogService.updateUniversity(id, body);
  }

  @Post("universities/:id/email-domains")
  addUniversityEmailDomain(@Param("id") id: string, @Body() body: AddUniversityEmailDomainDto) {
    return this.catalogService.addEmailDomain(id, body.domain);
  }

  @Delete("universities/:id")
  archiveUniversity(@Param("id") id: string) {
    return this.catalogService.archiveUniversity(id);
  }

  @Post("universities/:id/faculties")
  createFaculty(@Param("id") id: string, @Body() body: CreateFacultyDto) {
    return this.catalogService.createFaculty({
      universityId: id,
      name: body.name,
      ...(body.websiteUrl ? { websiteUrl: body.websiteUrl } : {}),
      ...(body.announcementUrl ? { announcementUrl: body.announcementUrl } : {})
    });
  }

  @Patch("faculties/:id")
  updateFaculty(@Param("id") id: string, @Body() body: UpdateFacultyDto) {
    return this.catalogService.updateFaculty(id, body);
  }

  @Post("universities/:universityId/faculties/:facultyId/departments")
  createDepartment(@Param("universityId") universityId: string, @Param("facultyId") facultyId: string, @Body() body: CreateDepartmentDto) {
    return this.catalogService.createDepartment({
      universityId,
      facultyId,
      name: body.name,
      educationLevel: body.educationLevel,
      ...(body.websiteUrl ? { websiteUrl: body.websiteUrl } : {}),
      ...(body.announcementUrl ? { announcementUrl: body.announcementUrl } : {}),
      ...(body.courseScheduleUrl ? { courseScheduleUrl: body.courseScheduleUrl } : {}),
      ...(body.examScheduleUrl ? { examScheduleUrl: body.examScheduleUrl } : {})
    });
  }

  @Patch("departments/:id")
  updateDepartment(@Param("id") id: string, @Body() body: UpdateDepartmentDto) {
    return this.catalogService.updateDepartment(id, body);
  }
}
