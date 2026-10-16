// Errores HTTP con el mismo cuerpo de respuesta que las excepciones de NestJS,
// para que el contrato con el frontend (message, code, statusCode) no cambie al
// mudar la API desde el backend Nest:
//   new BadRequestException("x")        -> { message: "x", error: "Bad Request", statusCode: 400 }
//   new BadRequestException()           -> { message: "Bad Request", statusCode: 400 }
//   new ConflictException({ code, ... }) -> el objeto tal cual

export type ErrorBody = Record<string, unknown>;

export class HttpException extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(response: string | ErrorBody, status: number) {
    const body =
      typeof response === "string" ? { statusCode: status, message: response } : response;
    super(typeof body.message === "string" ? body.message : `HTTP ${status}`);
    this.name = "HttpException";
    this.status = status;
    this.body = body;
  }

  getStatus() {
    return this.status;
  }

  getResponse() {
    return this.body;
  }
}

function defineException(status: number, error: string) {
  return class extends HttpException {
    constructor(response?: string | ErrorBody) {
      if (response === undefined) {
        super({ message: error, statusCode: status }, status);
      } else if (typeof response === "string") {
        super({ message: response, error, statusCode: status }, status);
      } else {
        super(response, status);
      }
    }
  };
}

export const BadRequestException = defineException(400, "Bad Request");
export const UnauthorizedException = defineException(401, "Unauthorized");
export const ForbiddenException = defineException(403, "Forbidden");
export const NotFoundException = defineException(404, "Not Found");
export const ConflictException = defineException(409, "Conflict");
export const PayloadTooLargeException = defineException(413, "Payload Too Large");
export const UnprocessableEntityException = defineException(422, "Unprocessable Entity");
export const InternalServerErrorException = defineException(500, "Internal Server Error");
export const ServiceUnavailableException = defineException(503, "Service Unavailable");
export const GatewayTimeoutException = defineException(504, "Gateway Timeout");
