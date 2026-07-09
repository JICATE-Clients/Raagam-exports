import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
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
import { CountMasterScreen } from "@/components/masters/count-master-screen";
import { YarnPurityMasterScreen } from "@/components/masters/yarn-purity-master-screen";
import { listStockUnits } from "@/lib/masters/stock-unit-service";
import { StockUnitMasterScreen } from "@/components/masters/stock-unit-master-screen";
import { listMaterials } from "@/lib/masters/material-service";
import { getActiveHeads } from "@/lib/finance/cost-heads/service";
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

  const [canCreate, canEdit, canDelete] = await Promise.all([
    can("masters", "create"),
    can("masters", "edit"),
    can("masters", "delete"),
  ]);
  const perms = { canCreate, canEdit, canDelete };

  let screen: React.ReactNode;
  if (isCustomChild(child)) {
    if (child.custom === "levies") {
      const [levies, accounts] = await Promise.all([listLevies(), getAccountsForPicker()]);
      screen = <LevyMasterScreen rows={levies} accounts={accounts} perms={perms} />;
    } else if (child.custom === "categories") {
      const [categories, lookups, levies] = await Promise.all([
        listCategories(),
        listConfigLookups(),
        listLevies(),
      ]);
      screen = (
        <CategoryMasterScreen
          rows={categories}
          itemClasses={lookups.filter((l) => l.kind === "item_class")}
          levies={levies}
          commodities={lookups.filter((l) => l.kind === "commodity")}
          perms={perms}
        />
      );
    } else if (child.custom === "material_attributes") {
      const [maRows, attributes, lookups, units] = await Promise.all([
        listMaterialAttributes(),
        listAttributes(),
        listConfigLookups(),
        listUoms(),
      ]);
      screen = (
        <MaterialAttributeMasterScreen
          rows={maRows}
          attributes={attributes}
          categories={lookups.filter((l) => l.kind === "material_category")}
          units={units}
          perms={perms}
        />
      );
    } else if (child.custom === "stock_units") {
      const stockUnits = await listStockUnits();
      screen = <StockUnitMasterScreen rows={stockUnits} perms={perms} />;
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
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "materials") {
      const [materials, all, categories, units, costHeads] = await Promise.all([
        listMaterials(),
        listConfigLookups(),
        listCategories(),
        listUoms(),
        getActiveHeads(),
      ]);
      screen = (
        <MaterialMasterScreen
          rows={materials}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          categories={categories}
          counts={all.filter((l) => l.kind === "yarn_count")}
          purities={all.filter((l) => l.kind === "yarn_purity")}
          hsnCodes={all.filter((l) => l.kind === "hsn_code")}
          units={units}
          costHeads={costHeads}
          perms={perms}
        />
      );
    } else if (child.custom === "processes") {
      const [processes, all] = await Promise.all([listProcesses(), listConfigLookups()]);
      screen = (
        <ProcessMasterScreen
          rows={processes}
          commodities={all.filter((l) => l.kind === "commodity")}
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
