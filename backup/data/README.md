# VeteranLedger – Data Layer Architecture

## Directory Structure

```
/data/
├── README.md                 # This file – architecture documentation
├── articles.json             # All article data for articles.html
├── battles.json              # All battle entries for battles.html
├── technology.json           # All technology/weapons entries for technology.html
├── veterans.json             # All veteran profiles for veterans.html
├── political.json            # Political entries and timeline for political.html
└── templates.js              # Reusable rendering templates
```

## How to Add New Entries

### Adding a new article
1. Open `/data/articles.json`
2. Add a new object to the `topicsData` array
3. Follow the existing schema (id, title, tags, description, fullArticle)
4. No HTML changes needed – the page will load the data automatically

### Adding a new battle
1. Open `/data/battles.json`
2. Add to the `battlesData` array with id, title, year, image, credit, description, longContent
3. The battle card will render automatically

### Adding new technology
1. Open `/data/technology.json`
2. Add to the `weaponsData` array with id, name, category, specs, fullDesc, legal
3. The card will render with all metadata

### Adding a veteran profile
1. Open `/data/veterans.json`
2. Add to the `veteransData` array with id, name, rank, category, biography, etc.
3. The profile card will render with all details

### Adding political entries
1. Open `/data/political.json`
2. Add to the `topicsData` array following the existing schema
3. Timeline entries can be added to the `timelineData` array

## Media Attribution System

Every image entry in the data files supports:
- `image` – the image URL or path
- `imageCredit` – compact attribution label
- `legal` object with `source`, `license`, `verificationDate` fields

The `imageCredit` field uses compact format:
- "Bundesarchiv · Public Domain ⓘ"
- "Wikimedia Commons · CC BY-SA ⓘ"
- "AI-assisted reconstruction ⓘ"

The ⓘ indicator signals clickable attribution that expands to show full source/license information.

## AI Image Labeling

Images can be tagged with their nature:
- `imageType: "archival"` – Authentic historical photograph
- `imageType: "ai-restoration"` – AI-assisted restoration of damaged original
- `imageType: "ai-illustration"` – AI-generated illustrative scene (not historical)

## Architecture

- JSON files contain all content data (separated from layout)
- `/js/templates.js` contains reusable rendering functions
- Each HTML page imports its JSON data and renders via templates
- CSS and visual appearance remain completely unchanged
