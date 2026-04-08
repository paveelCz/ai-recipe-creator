# 🍽 Recipe Finder — RAG-powered with Ollama + ChromaDB

A simple AI app that takes ingredients and suggests recipes. Uses **RAG (Retrieval Augmented Generation)** to search a vector database of recipes and pass the best matches to an LLM.

## How It Works

```
User types ingredients
       ↓
Embed query with Ollama (nomic-embed-text)
       ↓
Search ChromaDB for similar recipes
       ↓
Top 3 matches sent to Ollama as context
       ↓
LLM returns a grounded recipe suggestion
```

## Stack

| Layer       | Tech                      |
|-------------|---------------------------|
| Backend     | Node.js + Express         |
| AI / LLM    | Ollama (gemma3:1b)        |
| Embeddings  | Ollama (nomic-embed-text) |
| Vector DB   | ChromaDB                  |
| Frontend    | Plain HTML/CSS/JS         |
| Deployment  | Docker + Docker Compose   |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Ollama](https://ollama.com) installed and running locally

## Setup

### 1. Pull required Ollama models

```bash
ollama pull gemma3:1b
ollama pull nomic-embed-text
```

### 2. Clone and run

```bash
git clone https://github.com/YOUR_USERNAME/recipe-rag.git
cd recipe-rag
docker compose up --build
```

### 3. Open the app

Visit [http://localhost:3000](http://localhost:3000)

On first run, the app automatically seeds the database with 10 starter recipes.

---

## Usage

**Find a recipe:** Type ingredients (e.g. `chicken, garlic, lemon`) and press Search.

**Add your own recipe:** Click "+ Add Your Own Recipe", fill in the form, and submit. It gets embedded and stored in ChromaDB immediately.

---

## Project Structure

```
recipe-rag/
├── server.js              # Express backend + RAG logic
├── public/
│   └── index.html         # Frontend UI
├── data/
│   └── recipes.json       # Seed recipes loaded on first run
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Environment Variables

| Variable       | Default                       | Description             |
|----------------|-------------------------------|-------------------------|
| `OLLAMA_URL`   | `http://localhost:11434`      | Ollama server URL       |
| `CHROMA_URL`   | `http://localhost:8000`       | ChromaDB server URL     |
| `OLLAMA_MODEL` | `gemma3:1b`                   | LLM model to use        |
| `PORT`         | `3000`                        | App port                |
