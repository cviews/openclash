export type OpenAIErrorBody = {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
};

export class OpenAIError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | null;

  constructor(status: number, message: string, type: string, code: string | null = null) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
    this.type = type;
    this.code = code;
  }

  toJSON(): OpenAIErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    };
  }
}

export function modelNotFound(model: string): OpenAIError {
  return new OpenAIError(404, `Model '${model}' not found`, "invalid_request_error", "model_not_found");
}

export function unauthorized(): OpenAIError {
  return new OpenAIError(401, "Invalid API key", "authentication_error", "invalid_api_key");
}

export function badRequest(message: string): OpenAIError {
  return new OpenAIError(400, message, "invalid_request_error", null);
}

export function serviceUnavailable(message: string): OpenAIError {
  return new OpenAIError(503, message, "server_error", "service_unavailable");
}
