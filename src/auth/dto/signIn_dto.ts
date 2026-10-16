import { IsBoolean, IsEmail, IsNotEmpty, IsString, Length } from 'class-validator'

export class SignInDto {
    @IsEmail()
    @IsNotEmpty()
    email: string

    @IsString()
    @IsNotEmpty()
    @Length(6, 20)
    password: string

    @IsBoolean()
    rememberMe?: boolean 
}