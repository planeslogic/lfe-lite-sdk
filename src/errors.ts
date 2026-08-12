export class LfeLiteError extends Error {
  readonly code: string;
  readonly operation?: string;

  constructor(code: string, message: string, operation?: string) {
    super(message);
    this.name = "LfeLiteError";
    this.code = code;
    this.operation = operation;
  }
}
