import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission, can, getAppUser } from "@/lib/auth/server";
import { listConfigLookups, listAttributes, listItemClasses } from "@/lib/masters/extras-service";
import {
  findMaterialChild,
  isLinkChild,
  isCustomChild,
} from "@/lib/masters/registry";
import { listLevies } from "@/lib/masters/levy-service";
import { listMaterialAttributes } from "@/lib/masters/material-attribute-service";
import { listCategories } from "@/lib/masters/category-service";
import { listUoms } from "@/lib/masters/service";
import { getAccountsForPicker } from "@/lib/finance/gl-service";
import { PageHeader } from "@/components/ui/page-header";
import { LookupMasterScreen } from "@/components/masters/lookup-master-screen";
import { AttributeMasterScreen } from "@/components/masters/attribute-master-screen";
import { ItemClassMasterScreen } from "@/components/masters/item-class-master-screen";
import { LevyMasterScreen } from "@/components/masters/levy-master-screen";
import { MaterialAttributeMasterScreen } from "@/components/masters/material-attribute-master-screen";
import { CategoryMasterScreen } from "@/components/masters/category-master-screen";
import { CompositionMasterScreen } from "@/components/masters/composition-master-screen";
import { listCompositions } from "@/lib/masters/composition-service";
import { ProcessMasterScreen } from "@/components/masters/process-master-screen";
import { listProcesses } from "@/lib/masters/process-service";
import { ComponentMasterScreen } from "@/components/masters/component-master-screen";
import { listComponents } from "@/lib/masters/component-service";
import { GaugeMasterScreen } from "@/components/masters/gauge-master-screen";
import { KnittingDiaMasterScreen } from "@/components/masters/knitting-dia-master-screen";
import { OutDocumentTermMasterScreen } from "@/components/masters/out-document-term-master-screen";
import { listOutDocumentTerms } from "@/lib/masters/out-document-term-service";
import { CommodityMasterScreen } from "@/components/masters/commodity-master-screen";
import { listCommodities } from "@/lib/masters/commodity-service";
import { SeasonMasterScreen } from "@/components/masters/season-master-screen";
import { listSeasons } from "@/lib/masters/season-service";
import { ColorMasterScreen } from "@/components/masters/color-master-screen";
import { listColors } from "@/lib/masters/color-service";
import { BrandMasterScreen } from "@/components/masters/brand-master-screen";
import { listBrands } from "@/lib/masters/brand-service";
import { BinMasterScreen } from "@/components/masters/bin-master-screen";
import { listBins } from "@/lib/masters/bin-service";
import { SizeGroupMasterScreen } from "@/components/masters/size-group-master-screen";
import { listSizeGroups } from "@/lib/masters/size-group-service";
import { ShadeGroupMasterScreen } from "@/components/masters/shade-group-master-screen";
import { listShadeGroups } from "@/lib/masters/shade-group-service";
import { listCountries } from "@/lib/masters/country-service";
import { listEmployeeLocations } from "@/lib/masters/employee-service";
import { StyleNameMasterScreen } from "@/components/masters/style-name-master-screen";
import { listStyleNames } from "@/lib/masters/style-name-service";
import { StyleLevelMasterScreen } from "@/components/masters/style-level-master-screen";
import { listStyleLevels } from "@/lib/masters/style-level-service";
import { PackingInstructionMasterScreen } from "@/components/masters/packing-instruction-master-screen";
import { listPackingInstructions } from "@/lib/masters/packing-instruction-service";
import { PackingMethodMasterScreen } from "@/components/masters/packing-method-master-screen";
import { listPackingMethods } from "@/lib/masters/packing-method-service";
import { GarmentRejectionRuleMasterScreen } from "@/components/masters/garment-rejection-rule-master-screen";
import { listGarmentRejectionRules } from "@/lib/masters/garment-rejection-rule-service";
import { CountMasterScreen } from "@/components/masters/count-master-screen";
import { YarnPurityMasterScreen } from "@/components/masters/yarn-purity-master-screen";
import { listStockUnits } from "@/lib/masters/stock-unit-service";
import { StockUnitMasterScreen } from "@/components/masters/stock-unit-master-screen";
import { listMaterials } from "@/lib/masters/material-service";
import { MaterialMasterScreen } from "@/components/masters/material-master-screen";
import { listHsnDetails } from "@/lib/masters/hsn-detail-service";
import { hsnDetailsAsLookups } from "@/lib/masters/lookup-compat";
// --- Phase 1: Simple masters ---
import {
  listYarnCompositions,
  listDefectGroupsSimple,
  listStyleStockCategories,
  listSpecialInstructions,
  listBeamTypesSimple,
  listDesigns,
  listDomesticProductDesigns,
  listLabTestStandards,
  listProductTypes,
} from "@/lib/masters/simple-master-service";
import { YarnCompositionMasterScreen } from "@/components/masters/yarn-composition-master-screen";
import { DefectGroupMasterScreen } from "@/components/masters/defect-group-master-screen";
import { StyleStockCategoryMasterScreen } from "@/components/masters/style-stock-category-master-screen";
import { SpecialInstructionMasterScreen } from "@/components/masters/special-instruction-master-screen";
import { BeamTypeMasterScreen } from "@/components/masters/beam-type-master-screen";
import { DesignMasterScreen } from "@/components/masters/design-master-screen";
import { DomesticProductDesignMasterScreen } from "@/components/masters/domestic-product-design-master-screen";
import { LabTestStandardMasterScreen } from "@/components/masters/lab-test-standard-master-screen";
import { ProductTypeMasterScreen } from "@/components/masters/product-type-master-screen";
// --- Phase 1: Dedicated masters ---
import { listDefectDetails, listDefectGroups } from "@/lib/masters/defect-detail-service";
import { DefectDetailMasterScreen } from "@/components/masters/defect-detail-master-screen";
import { listProductSizes } from "@/lib/masters/product-size-service";
import { ProductSizeMasterScreen } from "@/components/masters/product-size-master-screen";
import { listProductionSections } from "@/lib/masters/production-section-service";
import { ProductionSectionMasterScreen } from "@/components/masters/production-section-master-screen";
import { listBeams, listBeamVendors } from "@/lib/masters/beam-service";
import { BeamMasterScreen } from "@/components/masters/beam-master-screen";
import { listTyres } from "@/lib/masters/tyre-service";
import { TyreMasterScreen } from "@/components/masters/tyre-master-screen";
import { listPrintTypes } from "@/lib/masters/print-type-service";
import { PrintTypeMasterScreen } from "@/components/masters/print-type-master-screen";
import { listPrintItems } from "@/lib/masters/print-item-service";
import { PrintItemMasterScreen } from "@/components/masters/print-item-master-screen";
import { listPrintProcesses } from "@/lib/masters/print-process-service";
import { PrintProcessMasterScreen } from "@/components/masters/print-process-master-screen";
import { listGarmentAcceptedQtyLevels } from "@/lib/masters/garment-accepted-qty-level-service";
import { GarmentAcceptedQtyLevelMasterScreen } from "@/components/masters/garment-accepted-qty-level-master-screen";
// --- Phase 2: Grid masters ---
import {
  listCountGroups,
  listConstructions,
  listYarnPurchaseRates,
  listYarnDebitRates,
  listSizingRates,
  listWarpLengthAllowances,
  listProcessSequences,
  listProcessSequenceGroups,
} from "@/lib/masters/grid-master-service";
import { CountGroupMasterScreen } from "@/components/masters/count-group-master-screen";
import { ConstructionMasterScreen } from "@/components/masters/construction-master-screen";
import { YarnPurchaseRateMasterScreen } from "@/components/masters/yarn-purchase-rate-master-screen";
import { YarnDebitRateMasterScreen } from "@/components/masters/yarn-debit-rate-master-screen";
import { SizingRateMasterScreen } from "@/components/masters/sizing-rate-master-screen";
import { WarpLengthAllowanceMasterScreen } from "@/components/masters/warp-length-allowance-master-screen";
import { ProcessSequenceMasterScreen } from "@/components/masters/process-sequence-master-screen";
import { ProcessSequenceGroupMasterScreen } from "@/components/masters/process-sequence-group-master-screen";

export default async function MaterialEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  await requirePermission("masters", "view");
  const { entity } = await params;

  const child = findMaterialChild(entity);
  if (!child) notFound();
  if (isLinkChild(child)) redirect(child.href); // rich masters that live in their own tabs

  const [canCreate, canEdit, canDelete, canExport, appUser] = await Promise.all([
    can("masters", "create"),
    can("masters", "edit"),
    can("masters", "delete"),
    can("masters", "export"),
    getAppUser(),
  ]);
  const perms = { canCreate, canEdit, canDelete, canExport, isSuperAdmin: appUser?.isSuperAdmin ?? false };

  let screen: React.ReactNode;
  if (isCustomChild(child)) {
    if (child.custom === "levies") {
      const [levies, accounts, lookups] = await Promise.all([listLevies(), getAccountsForPicker(), listConfigLookups()]);
      screen = (
        <LevyMasterScreen
          rows={levies}
          accounts={accounts}
          dutyCategories={lookups.filter((l) => l.kind === "duty_category")}
          perms={perms}
        />
      );
    } else if (child.custom === "categories") {
      const [categories, lookups, levies, commodities, sizeGroups] = await Promise.all([
        listCategories(),
        listConfigLookups(),
        listLevies(),
        listCommodities(),
        listSizeGroups(),
      ]);
      screen = (
        <CategoryMasterScreen
          rows={categories}
          itemClasses={lookups.filter((l) => l.kind === "item_class")}
          levies={levies}
          commodities={commodities}
          fabricStructures={lookups.filter((l) => l.kind === "fabric_structure")}
          sizeGroups={sizeGroups}
          perms={perms}
        />
      );
    } else if (child.custom === "material_attributes") {
      const [maRows, categories, attributes, units] = await Promise.all([
        listMaterialAttributes(),
        listCategories(),
        listAttributes(),
        listUoms(),
      ]);
      screen = (
        <MaterialAttributeMasterScreen
          rows={maRows}
          categories={categories}
          // Material Attribute only ever applies to Pack & Sew accessories —
          // never the full item-class list (Fabric, Yarn, Capital Goods, …).
          attributes={attributes.filter((a) => ["PACK", "SEW"].includes(a.code ?? ""))}
          units={units}
          perms={perms}
        />
      );
    } else if (child.custom === "stock_units") {
      const [stockUnits, all] = await Promise.all([listStockUnits(), listConfigLookups()]);
      screen = (
        <StockUnitMasterScreen
          rows={stockUnits}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "counts") {
      const all = await listConfigLookups();
      screen = (
        <CountMasterScreen rows={all.filter((l) => l.kind === "yarn_count")} perms={perms} />
      );
    } else if (child.custom === "yarn_purities") {
      const all = await listConfigLookups();
      screen = (
        <YarnPurityMasterScreen rows={all.filter((l) => l.kind === "yarn_purity")} perms={perms} />
      );
    } else if (child.custom === "compositions") {
      const [compositions, all] = await Promise.all([listCompositions(), listConfigLookups()]);
      screen = (
        <CompositionMasterScreen
          rows={compositions}
          // Composition (fibre mixing %) only ever applies to Fabric — never
          // the full item-class list (Yarn, Pack, Sew, Garments, …).
          itemClasses={all.filter((l) => l.kind === "item_class" && l.code === "FABRIC")}
          perms={perms}
        />
      );
    } else if (child.custom === "materials") {
      const [materials, all, categories, units, hsnRows, materialAttributes, attributeList] = await Promise.all([
        listMaterials(),
        listConfigLookups(),
        listCategories(),
        listUoms(),
        listHsnDetails(),
        listMaterialAttributes(),
        listAttributes(),
      ]);
      screen = (
        <MaterialMasterScreen
          rows={materials}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          categories={categories}
          counts={all.filter((l) => l.kind === "yarn_count")}
          purities={all.filter((l) => l.kind === "yarn_purity")}
          hsnCodes={hsnDetailsAsLookups(hsnRows)}
          fabricTypes={all.filter((l) => l.kind === "fabric_type")}
          yarnTypes={all.filter((l) => l.kind === "yarn_type")}
          fabricStructures={all.filter((l) => l.kind === "fabric_structure")}
          units={units}
          materialAttributes={materialAttributes}
          attributes={attributeList}
          perms={perms}
        />
      );
    } else if (child.custom === "processes") {
      const [processes, commodities, all] = await Promise.all([
        listProcesses(),
        listCommodities(),
        listConfigLookups(),
      ]);
      screen = (
        <ProcessMasterScreen
          rows={processes}
          commodities={commodities}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "components") {
      const components = await listComponents();
      screen = <ComponentMasterScreen rows={components} perms={perms} />;
    } else if (child.custom === "gauges") {
      const all = await listConfigLookups();
      screen = <GaugeMasterScreen rows={all.filter((l) => l.kind === "gauge")} perms={perms} />;
    } else if (child.custom === "knitting_dias") {
      const all = await listConfigLookups();
      screen = (
        <KnittingDiaMasterScreen rows={all.filter((l) => l.kind === "knitting_dia")} perms={perms} />
      );
    } else if (child.custom === "out_document_terms") {
      const [terms, processes, all] = await Promise.all([
        listOutDocumentTerms(),
        listProcesses(),
        listConfigLookups(),
      ]);
      screen = (
        <OutDocumentTermMasterScreen
          rows={terms}
          processes={processes}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "commodities") {
      const [commodities, all] = await Promise.all([listCommodities(), listConfigLookups()]);
      screen = (
        <CommodityMasterScreen
          rows={commodities}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "seasons") {
      const rows = await listSeasons();
      screen = <SeasonMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "colors") {
      const rows = await listColors();
      screen = <ColorMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "brands") {
      const [rows, countries] = await Promise.all([listBrands(), listCountries()]);
      screen = <BrandMasterScreen rows={rows} countries={countries} perms={perms} />;
    } else if (child.custom === "bins") {
      const [rows, locations] = await Promise.all([listBins(), listEmployeeLocations()]);
      screen = <BinMasterScreen rows={rows} locations={locations} perms={perms} />;
    } else if (child.custom === "size_groups") {
      const rows = await listSizeGroups();
      screen = <SizeGroupMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "shade_groups") {
      const rows = await listShadeGroups();
      screen = <ShadeGroupMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "style_names") {
      const rows = await listStyleNames();
      screen = <StyleNameMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "style_levels") {
      const rows = await listStyleLevels();
      screen = <StyleLevelMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "packing_instructions") {
      const rows = await listPackingInstructions();
      screen = <PackingInstructionMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "packing_methods") {
      const rows = await listPackingMethods();
      screen = <PackingMethodMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "garment_rejection_rules") {
      const rows = await listGarmentRejectionRules();
      screen = <GarmentRejectionRuleMasterScreen rows={rows} perms={perms} />;
    // --- Phase 1: Simple masters (rows + perms only) ---
    } else if (child.custom === "yarn_compositions") {
      const rows = await listYarnCompositions();
      screen = <YarnCompositionMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "defect_groups") {
      const rows = await listDefectGroupsSimple();
      screen = <DefectGroupMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "style_stock_categories") {
      const rows = await listStyleStockCategories();
      screen = <StyleStockCategoryMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "special_instructions") {
      const rows = await listSpecialInstructions();
      screen = <SpecialInstructionMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "beam_types") {
      const rows = await listBeamTypesSimple();
      screen = <BeamTypeMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "designs") {
      const rows = await listDesigns();
      screen = <DesignMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "domestic_product_designs") {
      const rows = await listDomesticProductDesigns();
      screen = <DomesticProductDesignMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "lab_test_standards") {
      const rows = await listLabTestStandards();
      screen = <LabTestStandardMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "product_types") {
      const rows = await listProductTypes();
      screen = <ProductTypeMasterScreen rows={rows} perms={perms} />;
    // --- Phase 1: Dedicated masters ---
    } else if (child.custom === "defect_details") {
      const [rows, defectGroups] = await Promise.all([listDefectDetails(), listDefectGroups()]);
      screen = <DefectDetailMasterScreen rows={rows} defectGroups={defectGroups} perms={perms} />;
    } else if (child.custom === "product_sizes") {
      const rows = await listProductSizes();
      screen = <ProductSizeMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "production_sections") {
      const rows = await listProductionSections();
      screen = <ProductionSectionMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "beams") {
      const [rows, vendors] = await Promise.all([listBeams(), listBeamVendors()]);
      screen = <BeamMasterScreen rows={rows} vendors={vendors} perms={perms} />;
    } else if (child.custom === "tyres") {
      const rows = await listTyres();
      screen = <TyreMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "print_types") {
      const rows = await listPrintTypes();
      screen = <PrintTypeMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "print_items") {
      const rows = await listPrintItems();
      screen = <PrintItemMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "print_processes") {
      const rows = await listPrintProcesses();
      screen = <PrintProcessMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "garment_accepted_qty_levels") {
      const rows = await listGarmentAcceptedQtyLevels();
      screen = <GarmentAcceptedQtyLevelMasterScreen rows={rows} perms={perms} />;
    // --- Phase 2: Grid masters ---
    } else if (child.custom === "count_groups") {
      const [rows, lookups] = await Promise.all([listCountGroups(), listConfigLookups()]);
      const counts = lookups.filter((l) => l.kind === "yarn_count").map((l) => ({ id: l.id, code: l.code ?? "", name: l.name }));
      screen = <CountGroupMasterScreen rows={rows} counts={counts} perms={perms} />;
    } else if (child.custom === "constructions") {
      const [rows, lookups, materials] = await Promise.all([listConstructions(), listConfigLookups(), listMaterials()]);
      const counts = lookups.filter((l) => l.kind === "yarn_count").map((l) => ({ id: l.id, code: l.code ?? "", name: l.name }));
      const items = materials.map((m) => ({ id: m.id, code: m.code ?? "", name: m.name ?? "" }));
      screen = <ConstructionMasterScreen rows={rows} counts={counts} items={items} perms={perms} />;
    } else if (child.custom === "yarn_purchase_rates") {
      const [rows, lookups, categories, materials] = await Promise.all([
        listYarnPurchaseRates(), listConfigLookups(), listCategories(), listMaterials(),
      ]);
      const cats = categories.map((c) => ({ id: c.id, code: c.short_name ?? "", name: c.name ?? "" }));
      const items = materials.map((m) => ({ id: m.id, code: m.code ?? "", name: m.name ?? "" }));
      const purities = lookups.filter((l) => l.kind === "yarn_purity").map((l) => ({ id: l.id, code: l.code ?? "", name: l.name }));
      screen = <YarnPurchaseRateMasterScreen rows={rows} categories={cats} items={items} purities={purities} perms={perms} />;
    } else if (child.custom === "yarn_debit_rates") {
      const [rows, materials] = await Promise.all([listYarnDebitRates(), listMaterials()]);
      const items = materials.map((m) => ({ id: m.id, code: m.code ?? "", name: m.name ?? "" }));
      screen = <YarnDebitRateMasterScreen rows={rows} items={items} perms={perms} />;
    } else if (child.custom === "sizing_rates") {
      const [rows, categories, materials] = await Promise.all([listSizingRates(), listCategories(), listMaterials()]);
      const cats = categories.map((c) => ({ id: c.id, code: c.short_name ?? "", name: c.name ?? "" }));
      const items = materials.map((m) => ({ id: m.id, code: m.code ?? "", name: m.name ?? "" }));
      screen = <SizingRateMasterScreen rows={rows} categories={cats} items={items} perms={perms} />;
    } else if (child.custom === "warp_length_allowances") {
      const rows = await listWarpLengthAllowances();
      screen = <WarpLengthAllowanceMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "process_sequences") {
      const rows = await listProcessSequences();
      screen = <ProcessSequenceMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "process_sequence_groups") {
      const [rows, sequences] = await Promise.all([listProcessSequenceGroups(), listProcessSequences()]);
      screen = <ProcessSequenceGroupMasterScreen rows={rows} sequences={sequences} perms={perms} />;
    } else if (child.custom === "item_class") {
      const rows = await listItemClasses();
      screen = <ItemClassMasterScreen rows={rows} perms={perms} />;
    } else {
      const attributes = await listAttributes();
      screen = <AttributeMasterScreen rows={attributes} perms={perms} />;
    }
  } else {
    const all = await listConfigLookups();
    const rows = all.filter((l) => l.kind === child.kind);
    screen = (
      <LookupMasterScreen
        kind={child.kind}
        singular={child.singular}
        rows={rows}
        perms={perms}
      />
    );
  }

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/masters" className="hover:text-primary">
          Master Data
        </Link>{" "}
        /{" "}
        <Link href="/masters/materials" className="hover:text-primary">
          Materials
        </Link>{" "}
        / <span className="text-foreground">{child.label}</span>
      </nav>
      <PageHeader
        title={child.label}
        description={child.description}
        actions={
          <Link
            href="/masters/materials"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            ← Materials
          </Link>
        }
      />
      {screen}
    </div>
  );
}
