import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission, can, getAppUser } from "@/lib/auth/server";
import { listConfigLookups, listAttributes } from "@/lib/masters/extras-service";
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
import { CountMasterScreen } from "@/components/masters/count-master-screen";
import { YarnPurityMasterScreen } from "@/components/masters/yarn-purity-master-screen";
import { listStockUnits } from "@/lib/masters/stock-unit-service";
import { StockUnitMasterScreen } from "@/components/masters/stock-unit-master-screen";
import { listMaterials } from "@/lib/masters/material-service";
import { MaterialMasterScreen } from "@/components/masters/material-master-screen";

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
      const [materials, all, categories, units] = await Promise.all([
        listMaterials(),
        listConfigLookups(),
        listCategories(),
        listUoms(),
      ]);
      screen = (
        <MaterialMasterScreen
          rows={materials}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          categories={categories}
          counts={all.filter((l) => l.kind === "yarn_count")}
          purities={all.filter((l) => l.kind === "yarn_purity")}
          hsnCodes={all.filter((l) => l.kind === "hsn_code")}
          fabricTypes={all.filter((l) => l.kind === "fabric_type")}
          yarnTypes={all.filter((l) => l.kind === "yarn_type")}
          fabricStructures={all.filter((l) => l.kind === "fabric_structure")}
          units={units}
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
