import { africasTalkingSmsSender, logSmsSender, type SmsSender } from "@/sms";
import { env } from "./env";

// The server's SMS adapter, chosen by SMS_PROVIDER: the log adapter in
// development, Africa's Talking where the code has to reach a phone.
export function serverSms(): SmsSender {
  if (env.SMS_PROVIDER === "log") return logSmsSender();
  return africasTalkingSmsSender({
    username: env.AT_USERNAME as string,
    apiKey: env.AT_API_KEY as string,
    senderId: env.AT_SENDER_ID,
    baseUrl: env.AT_BASE_URL,
  });
}
