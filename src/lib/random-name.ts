import { humanId } from "human-id";

/** Generates a random three-word name like "brave-purple-fox". */
export function generateRandomName(): string {
  return humanId({ separator: "-", capitalize: false });
}
