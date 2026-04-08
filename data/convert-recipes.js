// convert-recipes.js
// Run this BEFORE starting the app to convert the Kaggle CSV into recipes.json
//
// Usage:
//   node convert-recipes.js <path-to-csv> [limit]
//
// Example:
//   node convert-recipes.js ./recipes.csv 50
//
// This will write to ./data/recipes.json

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const csvFile = process.argv[2];
const limit = parseInt(process.argv[3]) || 50; // default: 50 recipes

if (!csvFile) {
  console.error("❌ Usage: node convert-recipes.js <path-to-csv> [limit]");
  process.exit(1);
}

if (!fs.existsSync(csvFile)) {
  console.error(`❌ File not found: ${csvFile}`);
  process.exit(1);
}

// Complete CSV parser that handles quoted fields with commas and newlines inside
function parseCSVFile(content) {
  const rows = [];
  let current_row = [];
  let current_cell = "";
  let in_quotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '"') {
      if (in_quotes && i + 1 < content.length && content[i + 1] === '"') {
        current_cell += '"';
        i++;
      } else {
        in_quotes = !in_quotes;
      }
    } else if (ch === "," && !in_quotes) {
      current_row.push(current_cell.trim());
      current_cell = "";
    } else if ((ch === "\n" || ch === "\r") && !in_quotes) {
      if (ch === "\r" && i + 1 < content.length && content[i + 1] === "\n") {
        i++;
      }
      current_row.push(current_cell.trim());
      rows.push(current_row);
      current_row = [];
      current_cell = "";
    } else {
      current_cell += ch;
    }
  }

  if (current_cell !== "" || current_row.length > 0) {
    current_row.push(current_cell.trim());
    rows.push(current_row);
  }

  return rows;
}

// Helper to parse ingredients intelligently
function parseIngredients(rawStr) {
  if (rawStr.startsWith("[")) {
    try {
      const jsonStr = rawStr.replace(/^\[/, "[").replace(/\]$/, "]").replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch {
      rawStr = rawStr.replace(/[\[\]']/g, "");
    }
  }

  // Split by comma but NOT inside parentheses
  const parts = [];
  let current = "";
  let inParens = 0;
  for (let i = 0; i < rawStr.length; i++) {
    const ch = rawStr[i];
    if (ch === '(') inParens++;
    else if (ch === ')') inParens = Math.max(0, inParens - 1);
    
    if (ch === ',' && inParens === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const result = [];
  const modifiers = ["peeled", "cored", "sliced", "chopped", "divided", "melted", 
                     "softened", "beaten", "thawed", "unwrapped", "quartered", 
                     "or", "such as", "about", "for", "lightly", "optional", 
                     "taste", "drained", "minced", "crushed", "grated", "and"];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (result.length === 0) {
      result.push(part);
      continue;
    }

    const firstWord = part.toLowerCase().split(/[\s-]/)[0];
    const isModifier = modifiers.includes(firstWord) || 
                       part.toLowerCase().includes("to taste") ||
                       /^[a-z]+ed$/.test(firstWord); // ends in 'ed'

    const startsWithNumber = /^[0-9½¼¾⅓⅔⅛⅜⅝⅞]/.test(part);

    if (startsWithNumber) {
      result.push(part);
    } else if (isModifier) {
      // Append to previous ingredient
      result[result.length - 1] += ", " + part;
    } else {
      // Unsure, probably a new ingredient without a number
      result.push(part);
    }
  }
  
  return result;
}

async function convert() {
  const content = fs.readFileSync(csvFile, "utf-8");
  const allRows = parseCSVFile(content);

  let headers = null;
  const recipes = [];
  let skipped = 0;

  for (const cols of allRows) {
    if (cols.length === 1 && !cols[0]) continue; // Skip empty rows

    if (!headers) {
      headers = cols.map((h) => h.toLowerCase().trim());
      console.log("📋 Detected columns:", headers.join(", "));
      continue;
    }

    if (recipes.length >= limit) break;

    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] || ""));

    // Map columns — try common column name variants
    const title =
      row["title"] || row["name"] || row["recipe_name"] || "";
    const rawIngredients =
      row["ingredients"] || row["ingredient_list"] || "";
    const rawDirections =
      row["directions"] || row["instructions"] || row["steps"] || "";
      
    // Additional columns to extract
    const prep_time = row["prep_time"] || "";
    const cook_time = row["cook_time"] || "";
    const total_time = row["total_time"] || "";
    const servings = row["servings"] || "";
    const recipe_yield = row["yield"] || "";
    const rating = row["rating"] || "";
    const url = row["url"] || "";
    const cuisine_path = row["cuisine_path"] || "";
    const nutrition = row["nutrition"] || "";
    const timing = row["timing"] || "";

    // Skip rows with missing essential data
    if (!title || !rawIngredients || !rawDirections) {
      skipped++;
      continue;
    }

    // Parse ingredients intelligently
    const ingredients = parseIngredients(rawIngredients);

    // Parse directions — could be a Python list of steps or a plain string
    let instructions = rawDirections;
    if (rawDirections.startsWith("[")) {
      try {
        const jsonStr = rawDirections.replace(/^\[/, "[").replace(/\]$/, "]").replace(/'/g, '"');
        const steps = JSON.parse(jsonStr);
        instructions = steps.join(" ");
      } catch {
        instructions = rawDirections.replace(/[\[\]']/g, "").split(",").map(s => s.trim()).filter(Boolean).join(" ");
      }
    }

    // Clean up
    instructions = instructions.replace(/\s+/g, " ").trim();
    if (ingredients.length === 0 || instructions.length < 10) {
      skipped++;
      continue;
    }

    recipes.push({ 
      title, 
      prep_time,
      cook_time,
      total_time,
      servings,
      yield: recipe_yield,
      ingredients, 
      instructions,
      rating,
      url,
      cuisine_path,
      nutrition,
      timing
    });
  }

  // Write output
  const outPath = path.join(__dirname, "recipes.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(recipes, null, 2));

  console.log(`\n✅ Done!`);
  console.log(`   Converted : ${recipes.length} recipes`);
  console.log(`   Skipped   : ${skipped} (missing data)`);
  console.log(`   Output    : ${outPath}`);
  console.log(`\n🚀 You can now run: docker compose up --build`);
}

convert().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
