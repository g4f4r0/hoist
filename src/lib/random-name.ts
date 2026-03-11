const ADJECTIVES = [
  "swift", "bright", "calm", "bold", "cool", "eager", "fair", "grand",
  "keen", "neat", "prime", "quick", "rare", "sharp", "warm", "vivid",
  "crisp", "fresh", "glad", "noble", "proud", "quiet", "rapid", "safe",
  "tidy", "wise", "agile", "brave", "clear", "deft", "fleet", "hardy",
  "light", "mild", "plain", "sleek", "snug", "solid", "steady", "terse",
  "true", "vital", "witty", "apt", "zen", "lucky", "lush", "merry",
  "polar", "coral",
];

const NOUNS = [
  "falcon", "maple", "river", "stone", "cedar", "frost", "heron", "lotus",
  "orbit", "quartz", "ridge", "spark", "tower", "viper", "wave", "amber",
  "blaze", "cliff", "dune", "fern", "grove", "haven", "jade", "lark",
  "marsh", "opal", "pine", "reef", "sage", "tide", "vale", "wren",
  "birch", "crane", "delta", "ember", "flint", "gale", "hawk", "iris",
  "knoll", "mesa", "nova", "peak", "rill", "shore", "thorn", "vine",
  "brook", "cove",
];

/** Generates a random two-word name like "swift-falcon". */
export function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}
