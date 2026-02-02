import { IsBoolean, IsEnum, IsOptional, IsString, Length } from "class-validator";
import { Role } from "../../../generated/prisma";

export class UpdateUserDTO {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}

