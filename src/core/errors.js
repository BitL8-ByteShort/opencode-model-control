export class RouterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RouterError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function routerError(code, message, details = undefined) {
  return new RouterError(code, message, details);
}
