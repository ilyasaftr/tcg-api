import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class SearchCityDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @IsString()
  query?: string; // Search query
}
