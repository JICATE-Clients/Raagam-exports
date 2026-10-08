# UI/UX Specification & Engineering Guide: Gamified Express Sample Costing Module (v2)

## 1. Executive Architectural Vision: From Spreadsheet Speed to Gamified ERP

The primary objective of this updated specification is to eliminate the friction traditional ERP interfaces create during pre-production sample costing. In garment manufacturing, merchandisers favor Excel because it allows them to enter three or four core numbers and generate an instant buyer quote. Conventional ERP screens force dozens of clicks across nested tabs, slowing down response times.

This specification introduces **Express Costing Engine (v2)**—a gamified, high-velocity interface that combines the speed of an interactive financial dashboard with the computational rigor of an enterprise manufacturing ERP.

### Canvas Layout Overview

The canvas adopts a responsive 65/35 split screen layout:
* **Top Header Control**: Mode selector (`⚡ Express Mode` vs `🔬 Pro Mode`) and 1-Click Preset Archetypes (`Tee`, `Hoodie`, `Set`).
* **Left Canvas (65% Width)**: Scrollspy-synced continuous form stack containing the core costing sections with compact table padding.
* **Right Panel (35% Width)**: Persistent commercial summary rail displaying real-time FOB prices, interactive margin sliders, and exchange rates.
* **Sticky Bottom Bar**: Gamified Costing Completion Score bar with interactive pulse navigation pills.

---

## 2. Dual-Engine Workflow: Express Mode vs. Pro Mode Architecture

To accommodate both rapid estimation and exhaustive cost auditing, the interface features a persistent top-level toggle that switches the canvas presentation without altering underlying mathematical state.

### Presentation Mode Comparison

| Feature / Dimension | ⚡ Express Mode (Default) | 🔬 Pro Mode (Deep Audit) |
| :--- | :--- | :--- |
| **Target User Experience** | 60-second rapid quote estimation | Exhaustive production order auditing |
| **Fabric Rate Input** | Single master dial (`Price / KG` with Direct Rate ON) | Multi-row Yarn Blend grid + Knit/Dye process loss breakdown |
| **Garment Processing** | Combined flat ₹/piece charge | Individual line items for Sewing CMT, Printing, Embroidery, Washing |
| **Trims & Accessories** | Lump-sum package allowance per piece | Granular itemized trim matrix (buttons, labels, polybags, cartons) |
| **Navigation Focus** | Single-screen 4-dial view | Scrollspy drill-down across all 6 detailed sections |

---

## 3. 1-Click Garment Template Presets & Smart Auto-Fill Engine

### 3.1 Preset Template Library
Located directly below the header title, merchandisers can select pre-configured garment archetype cards to instantly populate standard operational benchmarks.

| Preset Card | Pre-Configured Defaults | Target Use Case |
| :--- | :--- | :--- |
| **👕 Basic Jersey Tee** | Single Jersey 180 GSM, 165g weight, 12% process loss, Standard CMT ₹35, Basic Trims ₹12 | Single-piece promo/basic T-shirts |
| **🧥 Fleece Hoodie** | 3-Thread Fleece 320 GSM, 420g weight, 15% process loss, Hood CMT ₹75, Rib/Drawcord Trims ₹38 | Heavyweight autumn/winter tops |
| **🩳 2-Piece Sweatshirt Set** | Top (220g) + Bottom (180g), 2 Coordinates, Combined CMT ₹95, Multi-pack Trims ₹45 | Coordinated kids/baby sets |
| **👗 Polo Shirt** | Pique 220 GSM, 210g weight, Collar/Cuff Ribs, Button/Placket CMT ₹55, Brand Trims ₹25 | Premium collared garments |

### 3.2 Smart Historical Auto-Fill Engine
When a merchandiser selects a **Fabric Quality** or **Buyer** from the lookup controls, the system queries historic ERP transactions and auto-fills values:
1. **Historic Fabric Rate**: Automatically populates the last approved `Fabric Rate / KG` (e.g., ₹582.40/kg for *30s Combed BCI Cotton Single Jersey*).
2. **Standard Process Loss**: Pre-fills loss percentages based on fabric construction (e.g., 12% for Single Jersey, 18% for Yarn-dyed Auto Stripes).
3. **Overhead & Target Margins**: Auto-sets buyer-specific profit margins (e.g., Target 25% for EU buyers, 22% for US buyers).
4. **Visual Indicator**: Auto-filled fields display a subtle purple badge `[⚡ Auto-filled from Last Order]` which turns solid blue upon manual edit.

---

## 4. Gamified UI Components: Sliders, Profit Dials & Completion Score

### 4.1 Interactive Commercial Sliders & Dynamic Margin Badges
Rather than typing numbers into static text boxes, merchandisers use interactive range sliders for commercial tuning.

* **Profit Margin Slider**: Ranging from `0.0%` to `40.0%` in 0.5% increments.
* **Real-time Recalculation**: Dragging the slider immediately recalculates FOB Price in USD, EUR, and GBP without page refresh.
* **Dynamic Margin Target Badges**:
  * **🟢 Green Badge (`Margin >= 22.0%`)**: Meets commercial profit targets for standard buyer orders.
  * **🟡 Yellow Badge (`Margin 15.0% - 21.9%`)**: Acceptable margin; flagged for management review.
  * **🔴 Red Badge (`Margin < 15.0%`)**: Low margin warning; requires sales manager approval to generate quotation.

### 4.2 Gamified Costing Completion Score (Replacing Error Logs)
The negative "7 to fix" warning bar is replaced by an encouraging, progress-driven **Costing Completion Score**.

* **Visual Progress Bar**: Displays a dynamic bar transitioning from Orange (0–50%) to Yellow (51–80%) to Solid Green (81–100% Ready to Quote).
* **Interactive Pulse Navigation**: Clicking any missing item pill (e.g., `[ Exchange Rate* ]`) triggers an automated smooth scroll to that exact input field and highlights it with a 2-second glowing ring animation (`box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5)`).

---

## 5. Compact Canvas Layout, Scrollspy Nav & Component Matrix

### 5.1 65/35 Two-Column Responsive Grid Architecture
The canvas maintains a clean two-column split on desktop displays:
* **Left Canvas (65% Width)**: Scrollspy-synced vertical stack containing Sections 1 through 6 in compact card containers.
* **Right Panel (35% Width)**: Sticky commercial summary rail that remains fixed in the viewport during vertical scrolling.

### 5.2 Scrollspy Left Navigation
The left sidebar acts as an interactive scrollspy index:
* As the user scrolls through the document, the active section automatically highlights in the left menu.
* Clicking any sidebar item (e.g., `4. CMT & Processes`) triggers a smooth CSS scroll (`behavior: 'smooth'`) directly to that section header.

### 5.3 Multi-Piece Coordinate Component Support
For garment sets defined in Sample Entry (e.g., 2-Piece Top + Pants), Section 3 (Consumption) and Section 4 (CMT) automatically expand into multi-row coordinate tables:

| Line # | Component Name | Fabric Quality | Piece Weight (g) | Component CMT (₹) | Component Cost (₹) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **# 1** | **TOP / SWEATSHIRT** | 3-Thread Fleece | 240g | ₹ 55.00 | ₹ 194.78 |
| **# 2** | **BOTTOM / PANTS** | 2x2 Rib / Fleece | 180g | ₹ 40.00 | ₹ 145.22 |
| **SET TOTAL**| **2-PIECE SET** | **Combined** | **420g** | **₹ 95.00** | **₹ 340.00** |

---

## 6. Technical Design Tokens & Developer Implementation Checklist

### 6.1 Design Tokens (CSS Variables)

```css
:root {
  /* Brand & Status Colors */
  --costing-bg-main: #f8fafc;
  --costing-card-bg: #ffffff;
  --costing-border: #e2e8f0;
  
  --margin-green-bg: #dcfce7;
  --margin-green-text: #15803d;
  --margin-yellow-bg: #fef9c3;
  --margin-yellow-text: #a16207;
  --margin-red-bg: #fee2e2;
  --margin-red-text: #b91c1c;

  /* Typography & Density */
  --table-cell-padding: 6px 12px;
  --input-height-compact: 32px;
  --font-numeric-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

### 6.2 Developer Implementation Checklist
1. **[ ] Presentation Toggle**: Implement `Express Mode` state switch to toggle visibility of granular process sub-grids.
2. **[ ] Preset Injector**: Wire template preset buttons (`Tee`, `Hoodie`, `Set`) to pre-fill form state with standard benchmarks.
3. **[ ] Scrollspy Sync**: Attach `IntersectionObserver` to section headers to update left navigation active states dynamically.
4. **[ ] Range Slider Binding**: Connect `Profit Margin %` slider to reactive calculation hook updating USD/EUR quoted prices instantly.
5. **[ ] Completion Score Engine**: Implement validation engine returning completion percentage and array of incomplete fields.
6. **[ ] Pulse Glow Effect**: Add CSS keyframe animation for focus-targeting missing fields when clicked from the completion score rail.
