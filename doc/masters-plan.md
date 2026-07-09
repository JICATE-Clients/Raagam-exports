# Master Data — Phase 1 Build Plan (Materials · Associates · HR)

> Legacy source: RP Software EDP2 **Configure** module. New home: `/masters`.
> Decisions locked (2026-07-07): scope = first 3 submodules; UI = **hub + entity pages**;
> build = **config-driven generic engine**; process = **design-first** (Stitch/ui-ux) then implement.

## 0. Naming / how we "mention" a child

Every master is one **dotted registry key** that ties nav + route + descriptor + permission:

```
masters.<submodule>.<entity>
  e.g.  masters.materials.material_attribute
```

Nav path `/masters/materials/material-attribute`, descriptor key `masters.materials.material_attribute`,
permission `masters`. One id, four uses.

## 1. Entity registry — Materials submodule (15 children)

| # | Legacy child | Registry key | Backing today | Action |
|---|---|---|---|---|
| 1 | Attributes | `masters.materials.attribute` | — | **NEW** (extend `config_lookups` kind `attribute`) |
| 2 | Levies | `masters.materials.levy` | — | **NEW** (extend `config_lookups` kind `levy`) |
| 3 | Categories | `masters.materials.category` | `config_lookups:material_category` | wrap in engine |
| 4 | Material Attributes | `masters.materials.material_attribute` | — | **NEW** — needs field spec (attr→value map?) |
| 5 | Stock Units | `masters.materials.stock_unit` | `uoms` | wrap in engine |
| 6 | Counts | `masters.materials.count` | `config_lookups:yarn_count` | wrap |
| 7 | Yarn Purities | `masters.materials.yarn_purity` | `config_lookups:yarn_purity` | wrap |
| 8 | Compositions | `masters.materials.composition` | `config_lookups:composition` | wrap |
| 9 | **Materials (Master)** | `masters.materials.material` | `items` (thin) | **ENRICH** — add composition/count/purity/supplier/std_cost FKs |
| 10 | Processes | `masters.materials.process` | `config_lookups:process` | wrap |
| 11 | Components | `masters.materials.component` | `config_lookups:component` | wrap |
| 12 | Gauges | `masters.materials.gauge` | `config_lookups:gauge` | wrap |
| 13 | Knitting Dias | `masters.materials.knitting_dia` | `config_lookups:knitting_dia` | wrap |
| 14 | Out Document Terms | `masters.materials.out_doc_term` | — | **NEW** (extend `config_lookups` kind `out_doc_term`) |
| 15 | Commodities | `masters.materials.commodity` | `config_lookups:commodity` | wrap |

**Net-new DB work for Materials:** 3 new `config_lookups` kinds (attribute, levy, out_doc_term),
1 undecided (material_attribute — needs field capture), enrich `items` into a proper Material master.

## 2. Associates & HR (need child-list confirmation)

Legacy deep-capture only says "visible, not separately detailed". Known coverage:

- **Associates:** Buyers ✅ (`buyers`) · Vendors ✅ (`/purchase/vendors`) · Contractors ✅ (`/hr/contractors`) ·
  Transporters ✅ (`transporters`). Likely missing: Agents/Brokers 🔲. → surface existing via engine + confirm list.
- **HR:** Designations 🔲 · Departments/Sections ◐ · Grades/classifications 🔲 · Locations ◐ (`locations` seeded).
  → mostly NEW simple masters.

**ACTION:** get the Associates + HR child screenshots (same middle-panel list) to finalize their registries.

## 3. Architecture — config-driven generic master engine

```
lib/masters/registry.ts        MasterDescriptor[] — one entry per child (key, table, kind?,
                               label, columns, form fields, permission, lookups, softDelete)
components/masters/
  master-screen.tsx            reusable: search + DataTable + slide-over editor + data-io toolbar + RecordHistory
  master-hub.tsx               submodule cards → child links with live counts
app/(app)/masters/
  page.tsx                     hub (server: counts per entity)
  [submodule]/[entity]/page.tsx  resolves descriptor → <MasterScreen>
```

- **Reuse:** `DataTable`, `data-io/*` (import/export/bulk-delete), `RecordHistory` (audit 0041),
  `config_lookups` generic table, design tokens (DESIGN.md).
- **Escape hatch:** rich entities (Material Master) supply a custom form component in the descriptor.
- Adding a child = ~12-line registry entry.

## 4. UI — hub + entity pages (chosen)

- `/masters` hub: tabs/sections per submodule; each child = card with row-count.
- Entity screen: sticky search, `+ Add`, import/export; dense table; **right slide-over** editor
  (better than inline for dense masters); soft-delete + audit trail. Mobile: full-screen sheet.
- Sidebar `children` regrouped by submodule (collapsible, already default-collapsed).

## 5. Phased execution

- **Phase 0 — Design (now):** Stitch/ui-ux mockup of hub + entity screen from DESIGN.md tokens → sign-off.
- **Phase 1 — Engine:** `registry.ts` + `<MasterScreen>` + `<MasterHub>` + dynamic route. Wire the
  9 existing `config_lookups` + `uoms` children first (zero new DB) to prove the pattern.
- **Phase 2 — Materials gaps:** migration for 3 new lookup kinds + `material_attribute`; enrich Material Master.
- **Phase 3 — Associates + HR:** confirm child lists → migrations for new HR masters → register.
- **Phase 4 — Polish:** nav regroup, data-io descriptors for new entities, RBAC check, verify.

## 6. Tools / skills

- **Stitch MCP** — Phase 0 visual design (design system from DESIGN.md + hub/entity screens).
- **supabase-expert** skill — new tables, RLS matching 0218 style, apply via Supabase MCP.
- **nextjs-module-builder** skill — Next.js 16 route/server-action conventions.
- **data-io** engine — import/export descriptors for each new entity.
