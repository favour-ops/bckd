// nameMatcher.js
const stringSimilarity = require("string-similarity");

/**
 * Map of common short forms / nicknames (extend as needed)
 */
const nicknameMap = {
  seun: ["oluwaseun", "seun"],
  damilare: ["oluwadamilare", "damilare"],
  tope: ["oluwatope", "tope"],
  segun: ["olusegun", "segun"],
  femi: ["olufemi", "femi"],
  bayo: ["adebayo", "bayo"]
};

/**
 * Normalize a name string
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s.]/g, "") // allow initials with dot
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expand initials & nicknames
 */
function expandToken(token) {
  // Handle initials like "a." → "a"
  if (/^[a-z]\.$/.test(token)) {
    return token.replace(".", "");
  }

  // Handle nickname map
  for (const [canonical, variations] of Object.entries(nicknameMap)) {
    if (variations.includes(token)) {
      return canonical; // normalize to canonical form
    }
  }

  return token;
}

/**
 * Tokenize name string into comparable tokens
 */
function tokenizeName(name) {
  return normalizeName(name)
    .split(" ")
    .map(expandToken);
}

/**
 * Compare two names and return score
 */
function compareNames(name1, name2) {
  const tokens1 = tokenizeName(name1);
  const tokens2 = tokenizeName(name2);

  // Token overlap
  const matches = tokens1.filter(t => tokens2.includes(t));
  const matchRate = matches.length / Math.max(tokens1.length, tokens2.length);

  // String similarity (Levenshtein based, 0–1)
  const similarity = stringSimilarity.compareTwoStrings(
    normalizeName(name1),
    normalizeName(name2)
  );

  // Combine scores (weighted average)
  const combinedScore = Math.round(((matchRate * 0.6) + (similarity * 0.4)) * 100);

  return {
    name1,
    name2,
    tokens1,
    tokens2,
    matches,
    matchRate: Math.round(matchRate * 100), // percentage
    similarity: Math.round(similarity * 100), // percentage
    score: combinedScore, // final 0–100
    level:
      combinedScore >= 80 ? "strong" :
      combinedScore >= 60 ? "possible" : "weak"
  };
}

module.exports = { compareNames };
