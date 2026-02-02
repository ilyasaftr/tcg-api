import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterDTO {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsEmail()
    @IsNotEmpty()
    email!: string;

    @IsOptional()
    @IsString()
    turnstileToken?: string;
}
