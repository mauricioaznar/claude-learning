import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";

import { CreateUploadDto } from "./dto/create-upload.dto";
import { UploadsService } from "./uploads.service";

// The controller is thin: it maps HTTP to service calls and nothing more. All
// the logic lives in the service. Compare with Express, where handler and logic
// sit together in server.js.
@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get()
  list() {
    return this.uploads.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateUploadDto) {
    return this.uploads.sign(dto);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string) {
    return this.uploads.complete(id);
  }

  @Get(":id/url")
  downloadUrl(@Param("id") id: string) {
    return this.uploads.downloadUrl(id);
  }
}
