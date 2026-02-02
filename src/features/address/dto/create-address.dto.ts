import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateAddressDto {
  @IsNotEmpty()
  @IsString()
  label!: string;

  @IsNotEmpty()
  @IsString()
  recipientName!: string;

  @IsNotEmpty()
  @IsString()
  phoneNumber!: string;

  @IsNotEmpty()
  @IsInt()
  provinceId!: number;

  @IsNotEmpty()
  @IsString()
  provinceName!: string;

  @IsNotEmpty()
  @IsInt()
  cityId!: number;

  @IsNotEmpty()
  @IsString()
  cityName!: string;

  @IsNotEmpty()
  @IsString()
  districtName!: string;

  @IsNotEmpty()
  @IsString()
  subdistrictName!: string;

  @IsNotEmpty()
  @IsString()
  street!: string;

  @IsNotEmpty()
  @IsString()
  postalCode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
