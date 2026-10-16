import { IsString, Length, IsNotEmpty } from "class-validator"

export class ForgetPasswordDto {
    @IsString()
    @IsNotEmpty()
    @Length(8, 20)
    password: string

}