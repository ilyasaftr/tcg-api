import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class LoginDTO {
    @IsNotEmpty()
    @IsEmail()
    email!: string;
    
    @IsNotEmpty()
    @IsString()
    password!: string;

    @IsOptional()
    @IsString()
    turnstileToken?: string;
}
