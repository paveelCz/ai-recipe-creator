const fs = require('fs');
const data = JSON.parse(fs.readFileSync('c:/Users/pavel/Desktop/jarosuvshittyprojekt/data/recipes.json'));
const cuisines = new Set();
data.forEach(r => {
  if (r.cuisine_path) {
    const parts = r.cuisine_path.split('/').filter(Boolean);
    if (parts.length > 0) {
      cuisines.add(parts[0]);
    }
  }
});
console.log(Array.from(cuisines));
