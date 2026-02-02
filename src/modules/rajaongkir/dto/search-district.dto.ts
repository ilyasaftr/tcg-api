import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class SearchDistrictDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cityId?: number;

  @IsOptional()
  @IsString()
  query?: string;
}

