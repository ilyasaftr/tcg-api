import { ApiError } from "../../utils/api-error";

type TurnstileVerifyResponse = {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
  action?: string;
  cdata?: string;
};

export class TurnstileService {
  verify = async (args: { token: string | undefined; ip?: string }) => {
    const secret =
      process.env.CLOUDFLARE_SECRET_KEY ||
      (process.env.NODE_ENV !== "production"
        ? "1x0000000000000000000000000000000AA"
        : undefined);
    if (!secret) return; // captcha disabled

    const token = args.token?.trim();
    if (!token) throw new ApiError("Captcha is required", 400);

    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
    if (args.ip) params.set("remoteip", args.ip);

    let response: Response;
    try {
      response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        }
      );
    } catch (err) {
      throw new ApiError("Captcha verification unavailable", 503);
    }

    let data: TurnstileVerifyResponse;
    try {
      data = (await response.json()) as TurnstileVerifyResponse;
    } catch {
      throw new ApiError("Captcha verification unavailable", 503);
    }

    if (!data.success) {
      const codes = data["error-codes"]?.join(", ");
      throw new ApiError(
        codes ? `Captcha verification failed (${codes})` : "Captcha verification failed",
        400
      );
    }
  };
}
