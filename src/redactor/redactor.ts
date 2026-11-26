// The port to the redaction of an ID document's photo (spec §3, §4.2): the
// whole picture strongly blurred, what the public sees of it (no region is
// left sharp in v1). Local only: its adapter runs in the API's own process
// (`localRedactor`), since the photo it is given is an ID document's. Passed
// by the registry, never defaulted but at the app's entry point.
export interface RedactedImage {
  bytes: Uint8Array;
  contentType: "image/webp";
  width: number;
  height: number;
}

export interface ImageRedactor {
  blur(image: Uint8Array): Promise<RedactedImage>;
}

// The photo could not be decoded: it cannot be redacted, so it is never shown.
export class RedactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RedactionError";
  }
}
