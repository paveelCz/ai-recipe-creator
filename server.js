const express = require("express");
const { ChromaClient } = require("chromadb");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const EMBED_MODEL = "nomic-embed-text";
const CHAT_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const COLLECTION_NAME = "recipes_v2";

let collection;

// ── Ollama helpers ──────────────────────────────────────────────────────────

async function getEmbedding(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding;
}

async function chatWithOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.statusText}`);
  const data = await res.json();
  return data.response;
}

// ── ChromaDB setup ──────────────────────────────────────────────────────────

async function initChroma() {
  const client = new ChromaClient({ path: CHROMA_URL });

  collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });
  const count = await collection.count();
  
  if (count === 0) {
    console.log("✅ Collection is empty — seeding...");
    await seedRecipes();
  } else {
    console.log(`✅ Loaded existing recipe collection (count: ${count})`);
  }
}

async function seedRecipes() {
  const recipes = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data", "recipes.json"), "utf-8")
  );

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const text = recipeToText(r);
    const embedding = await getEmbedding(text);

    let cuisineCategory = "Uncategorized";
    if (r.cuisine_path) {
      const parts = r.cuisine_path.split("/").filter(Boolean);
      if (parts.length > 0) cuisineCategory = parts[0];
    }

    await collection.add({
      ids: [`seed-${i}`],
      embeddings: [embedding],
      documents: [text],
      metadatas: [{ title: r.title, source: "seed", cuisine_category: cuisineCategory }],
    });
    console.log(`  Seeded: ${r.title} (${cuisineCategory})`);
  }
  console.log("✅ Seeding complete");
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

    // 1. Embed the query
    const queryEmbedding = await getEmbedding(`ingredients: ${ingredients}`);

    // 2. Query ChromaDB for top 3 matches
    const queryConfig = {
      queryEmbeddings: [queryEmbedding],
      nResults: 3,
    };

    if (cuisines && Array.isArray(cuisines) && cuisines.length > 0) {
      if (cuisines.length === 1) {
        queryConfig.where = { cuisine_category: cuisines[0] };
      } else {
        queryConfig.where = { cuisine_category: { $in: cuisines } };
      }
    }

    const results = await collection.query(queryConfig);

    const contextRecipes = results.documents[0].join("\n\n---\n\n");

    // 3. Ask Ollama to suggest a recipe using the retrieved context
    const prompt = `You are a helpful cooking assistant. Based on the following recipes from our database, suggest the best recipe for someone who has these ingredients: ${ingredients}.

Here are relevant recipes from our database:
${contextRecipes}

Give a clear, friendly suggestion. If one of the database recipes fits well, recommend it and give the full instructions. If none fit perfectly, suggest a variation using the closest recipe as a base. Keep it concise.`;

    const answer = await chatWithOllama(prompt);
    res.json({ answer, context: results.metadatas[0].map((m) => m.title) });
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
    const embedding = await getEmbedding(text);
    const id = `user-${Date.now()}`;

    await collection.add({
      ids: [id],
      embeddings: [embedding],
      documents: [text],
      metadatas: [{ title, source: "user", cuisine_category: "User Recipes" }],
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
    const all = await collection.get();
    const titles = all.metadatas.map((m) => ({ title: m.title, source: m.source }));
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

const PORT = process.env.PORT || 3000;

async function start() {
  console.log("⏳ Connecting to ChromaDB...");
  let retries = 10;
  while (retries > 0) {
    try {
      await initChroma();
      break;
    } catch (e) {
      console.error(`  Error during initialization: ${e.message || e}`);
      console.log(`  Retrying... (${retries} left)`);
      retries--;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!collection) {
    console.error("❌ Could not connect to ChromaDB. Exiting.");
    process.exit(1);
  }

  app.listen(PORT, () => console.log(`🍽️  Server running on http://localhost:${PORT}`));
}

start();
