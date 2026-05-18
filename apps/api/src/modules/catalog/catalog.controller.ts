import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { CatalogService } from "./catalog.service.js";
import { ListUniversitiesQueryDto } from "./catalog.dto.js";

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Get("universities")
  listUniversities(@Query() query: ListUniversitiesQueryDto) {
    return this.catalogService.listUniversities({
      ...(query.search ? { search: query.search } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.includeInactive !== undefined ? { includeInactive: query.includeInactive === "true" } : {})
    });
  }

  @Get("universities/:id")
  getUniversity(@Param("id") id: string) {
    return this.catalogService.getUniversity(id);
  }

  @Get("universities/:id/faculties")
  listFaculties(@Param("id") id: string) {
    return this.catalogService.listFaculties(id);
  }

  @Get("faculties/:id/departments")
  listDepartments(@Param("id") id: string) {
    return this.catalogService.listDepartments(id);
  }
}
