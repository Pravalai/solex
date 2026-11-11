/** A business rule was violated (bad input, illegal state transition, limit exceeded). */
export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/** Someone else changed the record first (optimistic lock lost, unit taken). */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

/** The actor lacks the permission for this action. */
export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do this.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

/** Not found, or outside the actor's data scope. The two are deliberately indistinguishable. */
export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super("NOT_FOUND", `${entity} not found.`);
    this.name = "NotFoundError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
