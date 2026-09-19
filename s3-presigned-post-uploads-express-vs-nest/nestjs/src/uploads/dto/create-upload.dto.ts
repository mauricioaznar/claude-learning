import { IsInt, IsNotEmpty, IsPositive, IsString } from "class-validator";

// DTO + the global ValidationPipe check that the request is well-FORMED (right
// types, present fields). This is the Nest equivalent of the manual `typeof`
// checks in the Express handler.
//
// The *policy* checks (must be a PDF, must be under the cap) live in the service
// instead, because they depend on runtime config and map to specific HTTP status
// codes (415 / 413).
export class CreateUploadDto {
  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsInt()
  @IsPositive()
  size: number;
}
