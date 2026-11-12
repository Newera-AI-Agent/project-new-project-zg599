// Minimal stand-in for the `cloudflare:email` module used by upstream workers.
export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): EmailMessage;
  reply(message: unknown): Promise<void>;
}

export class EmailError extends Error {}

export class MimeMessage implements EmailMessage {
  from = "";
  to = "";
  headers = new Headers();
  raw = new ReadableStream();
  rawSize = 0;
  setReject(_reason: string): void {}
  forward(_rcptTo: string, _headers?: Headers): EmailMessage {
    return this;
  }
  async reply(_message: unknown): Promise<void> {}
}

export const createMimeMessage = (raw: unknown) => raw as EmailMessage;
