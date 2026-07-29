import { Body, Controller, Get, Headers, Inject, Ip, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { AuthApplicationService } from "./auth-application.service.js";
import { GoogleLoginDto, LoginDto, PasswordRecoveryConfirmDto, PasswordRecoveryRequestDto, RefreshTokenDto, RegisterDto, ResendVerificationCodeDto, VerifyEmailDto, VerifyEmailQueryDto } from "./auth.dto.js";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthApplicationService) private readonly authService: AuthApplicationService) {}

  @Post("register")
  register(@Body() body: RegisterDto, @Ip() ipAddress: string, @Headers("user-agent") userAgent?: string) {
    return this.authService.register({ ...body, ipAddress, ...(userAgent ? { userAgent } : {}) });
  }

  @Post("verify-email")
  verifyEmail(@Body() body: VerifyEmailDto, @Ip() ipAddress: string, @Headers("user-agent") userAgent?: string) {
    return this.authService.verifyEmail({ ...body, ipAddress, ...(userAgent ? { userAgent } : {}) });
  }

  @Post("resend-verification-code")
  resendVerificationCode(@Body() body: ResendVerificationCodeDto) {
    return this.authService.resendVerificationCode(body.email);
  }

  @Post("password-recovery/request")
  requestPasswordRecovery(@Body() body: PasswordRecoveryRequestDto) {
    return this.authService.requestPasswordRecovery(body.email);
  }

  @Post("password-recovery/confirm")
  confirmPasswordRecovery(@Body() body: PasswordRecoveryConfirmDto) {
    return this.authService.confirmPasswordRecovery(body);
  }

  @Get("verify-email")
  async verifyEmailByLink(@Query() query: VerifyEmailQueryDto, @Res() response: Response): Promise<void> {
    try {
      await this.authService.verifyEmailByLink({ token: query.token });
      response.status(200).type("text/html").send("<h1>E-posta doğrulandı</h1><p>Uygulamaya dönüp giriş yapabilirsiniz.</p>");
    } catch {
      response.status(400).type("text/html").send("<h1>E-posta doğrulanamadı</h1><p>Doğrulama bağlantısı geçersiz veya süresi dolmuş.</p>");
    }
  }

  @Post("login")
  login(@Body() body: LoginDto, @Ip() ipAddress: string, @Headers("user-agent") userAgent?: string) {
    return this.authService.login({ ...body, ipAddress, ...(userAgent ? { userAgent } : {}) });
  }

  @Post("google")
  googleLogin(@Body() body: GoogleLoginDto, @Ip() ipAddress: string, @Headers("user-agent") userAgent?: string) {
    return this.authService.loginWithGoogle({ ...body, ipAddress, ...(userAgent ? { userAgent } : {}) });
  }

  @Post("refresh-token")
  refresh(@Body() body: RefreshTokenDto, @Ip() ipAddress: string, @Headers("user-agent") userAgent?: string) {
    return this.authService.refresh({ ...body, ipAddress, ...(userAgent ? { userAgent } : {}) });
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  async logout(@Body() body: Pick<RefreshTokenDto, "refreshToken">): Promise<{ status: "ok" }> {
    await this.authService.logout(body.refreshToken);
    return { status: "ok" };
  }
}
