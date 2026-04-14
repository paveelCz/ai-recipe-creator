require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-3.5-turbo";

// In-memory array storing all recipes
let database = [];

// ── OpenAI helpers ──────────────────────────────────────────────────────────

async function chatWithOpenAI(prompt) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: prompt }]
    }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Database setup ──────────────────────────────────────────────────────────

async function initDatabase() {
  const raw = fs.readFileSync(path.join(__dirname, "data", "recipes.json"), "utf-8");
  const recipes = JSON.parse(raw);

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const text = recipeToText(r);

    let cuisineCategory = "Uncategorized";
    if (r.cuisine_path) {
      const parts = r.cuisine_path.split("/").filter(Boolean);
      if (parts.length > 0) cuisineCategory = parts[0];
    }

    database.push({
      id: `seed-${i}`,
      text: text,
      metadata: { title: r.title, source: "seed", cuisine_category: cuisineCategory }
    });
    console.log(`  Seeded: ${r.title} (${cuisineCategory})`);
  }
  console.log(`✅ Loaded recipe collection (count: ${database.length})`);
}

function recipeToText(r) {
  return `Recipe: ${r.title}\nIngredients: ${r.ingredients.join(", ")}\nInstructions: ${r.instructions}`;
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Search for recipes by ingredients
app.post("/api/search", async (req, res) => {
  try {
    const { ingredients, cuisines } = req.body;
    if (!ingredients) return res.status(400).json({ error: "ingredients required" });

    // 1. Tokenize query ingredients into keywords
    const keywords = ingredients.split(/[ ,\n]+/).map(k => k.toLowerCase().trim()).filter(k => k.length > 2);

    // 2. Filter and score local database
    let results = database.map(r => {
      let score = 0;
      const textLower = r.text.toLowerCase();
      keywords.forEach(k => {
        if (textLower.includes(k)) score += 1;
      });
      return { recipe: r, score };
    });

    if (cuisines && Array.isArray(cuisines) && cuisines.length > 0) {
      results = results.filter(r => cuisines.includes(r.recipe.metadata.cuisine_category));
    }

    results.sort((a, b) => b.score - a.score);
    const top3 = results.slice(0, 3).map(r => r.recipe);
    
    if (top3.length === 0) {
      throw new Error("No matching recipes found to create context.");
    }

    const contextRecipes = top3.map(r => r.text).join("\n\n---\n\n");

    // 3. Ask OpenAI to suggest a recipe using the retrieved context
    const prompt = `You are a helpful cooking assistant. Based on the following recipes from our database, suggest the best recipe for someone who has these ingredients: ${ingredients}.

Here are relevant recipes from our database:
${contextRecipes}

Give a clear, friendly suggestion. If one of the database recipes fits well, recommend it and give the full instructions. If none fit perfectly, suggest a variation using the closest recipe as a base. Keep it concise.`;

    const answer = await chatWithOpenAI(prompt);
    res.json({ answer, context: top3.map(r => r.metadata.title) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Add a new recipe to the DB
app.post("/api/recipe", async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;
    if (!title || !ingredients || !instructions) {
      return res.status(400).json({ error: "title, ingredients, and instructions are required" });
    }

    const text = recipeToText({ title, ingredients: ingredients.split(",").map((s) => s.trim()), instructions });
    const id = `user-${Date.now()}`;

    database.push({
      id: id,
      text: text,
      metadata: { title, source: "user", cuisine_category: "User Recipes" }
    });

    res.json({ success: true, message: `Recipe "${title}" added!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// List all recipe titles
app.get("/api/recipes", async (req, res) => {
  try {
    const titles = database.map(r => ({ title: r.metadata.title, source: r.metadata.source }));
    res.json(titles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let cachedCuisines = null;

// List all unique cuisine categories for the UI
app.get("/api/cuisines", (req, res) => {
  try {
    if (!cachedCuisines) {
      const raw = fs.readFileSync(path.join(__dirname, "data", "recipes.json"), "utf-8");
      const recipes = JSON.parse(raw);
      const cuisines = new Set();
      recipes.forEach(r => {
        if (r.cuisine_path) {
          const parts = r.cuisine_path.split("/").filter(Boolean);
          if (parts.length > 0) cuisines.add(parts[0]);
        }
      });
      cachedCuisines = Array.from(cuisines).sort();
    }
    res.json({ cuisines: cachedCuisines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 6767;

async function start() {
  console.log("⏳ Initializing database...");
  await initDatabase();
  app.listen(PORT, () => console.log(`🍽️  Server running on http://localhost:${PORT}`));
}

start();
