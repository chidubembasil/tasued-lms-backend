import { IsBoolean, IsEmail, IsNotEmpty, IsString, Length } from 'class-validator'
import type { UserRole } from '../../generated/prisma/client.js'

export class SignUpDto {
    @IsString()
    @IsNotEmpty()
    @Length(3)
    name: string

    @IsEmail()
    @IsNotEmpty()
    email: string

    @IsString()
    @IsNotEmpty()
    @Length(5)
    matricNumber?: string

    @IsString()
    @IsNotEmpty()
    @Length(5)
    staffID?: string

    @IsString()
    @IsNotEmpty()
    role: UserRole

    @IsString()
    @IsNotEmpty()
    @Length(6, 20)
    password: string

    

    @IsBoolean()
    rememberMe?: boolean 
}