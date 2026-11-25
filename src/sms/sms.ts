// The port to the SMS provider: what the API sends a phone, today the sign-in
// code and nothing else (spec §3: SMS carries the sign-in code only in v1).
// A module takes it as a required parameter, passed by the registry, never
// defaulted but at the app's entry point (`createApp`); a spec passes the
// `memorySmsSender` of test/sms.ts.
export interface SmsMessage {
  // E.164, the number the text goes to.
  to: string;
  text: string;
  // ISO 3166-1 alpha-2 of the number: the provider's sender id is per country.
  countryCode: string;
}

export interface SmsSender {
  // Resolves once the provider accepted the message; rejects with a
  // `SmsSendError` when it did not (the caller decides what to tell the user).
  send(message: SmsMessage): Promise<void>;
}

// The provider refused or did not answer. `retryable` says whether sending
// again can work (a timeout, a 5xx), as opposed to a refused number.
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SmsSendError";
  }
}
