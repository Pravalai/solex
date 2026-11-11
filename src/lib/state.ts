import { DomainError } from "./errors";

/** An explicit allowed-transitions table. Anything not listed is illegal. */
export type Machine<S extends string> = Record<S, readonly S[]>;

export function canTransition<S extends string>(machine: Machine<S>, from: S, to: S): boolean {
  return machine[from].includes(to);
}

export function assertTransition<S extends string>(machine: Machine<S>, entity: string, from: S, to: S): void {
  if (!canTransition(machine, from, to)) {
    throw new DomainError("ILLEGAL_TRANSITION", `${entity} cannot move from ${from} to ${to}.`);
  }
}
