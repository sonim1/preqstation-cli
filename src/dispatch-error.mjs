export class DispatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DispatchError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function isDispatchError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      typeof error.code === "string" &&
      error.name === "DispatchError",
  );
}

export function serializeDispatchError(error) {
  const payload = {
    code: error.code,
    message: error instanceof Error ? error.message : String(error),
  };

  for (const [key, value] of Object.entries(error)) {
    if (key === "code" || key === "name" || typeof value === "undefined") {
      continue;
    }
    payload[key] = value;
  }

  return payload;
}
