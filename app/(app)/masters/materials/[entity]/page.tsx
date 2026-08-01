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
import { BinMasterScreen } from "@/components/masters/bin-master-screen";
import { listBins } from "@/lib/masters/bin-service";
// Size Groups lost its own master screen with the 2026-08-01 withdrawal, but
// `listSizeGroups` STAYS: Categories (a survivor) renders a size-group field,
// so the service and its types outlive the screen. Same for the table — see
// the note at the head of 0382.
import { listSizeGroups } from "@/lib/masters/size-group-service";
import { listEmployeeLocations } from "@/lib/masters/employee-service";
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
import { listDefectGroupsSimple } from "@/lib/masters/simple-master-service";
import { DefectGroupMasterScreen } from "@/components/masters/defect-group-master-screen";
// --- Phase 1: Dedicated masters ---
import { listDefectDetails, listDefectGroups } from "@/lib/masters/defect-detail-service";
import { DefectDetailMasterScreen } from "@/components/masters/defect-detail-master-screen";
import { isAccessoryClass } from "@/lib/masters/material-types";

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
      const [categories, lookups, levies, sizeGroups] = await Promise.all([
        listCategories(),
        listConfigLookups(),
        listLevies(),
        listSizeGroups(),
      ]);
      screen = (
        <CategoryMasterScreen
          rows={categories}
          itemClasses={lookups.filter((l) => l.kind === "item_class")}
          levies={levies}
          fabricStructures={lookups.filter((l) => l.kind === "fabric_structure")}
          sizeGroups={sizeGroups}
          perms={perms}
        />
      );
    } else if (child.custom === "material_attributes") {
      // No listUoms() here any more: the Unit on a stepped attribute line is a
      // typed label, not a UOM reference (client 2026-07-28).
      const [maRows, categories, attributes, all, levies] = await Promise.all([
        listMaterialAttributes(),
        listCategories(),
        listAttributes(),
        listConfigLookups(),
        listLevies(),
      ]);
      screen = (
        <MaterialAttributeMasterScreen
          rows={maRows}
          categories={categories}
          // Material Attribute only ever applies to Pack & Sew accessories —
          // never the full item-class list (Fabric, Yarn, Capital Goods, …).
          // Same predicate the material form uses to decide whether to ASK the
          // questions, so the two can never drift apart.
          attributes={attributes.filter((a) => isAccessoryClass(a.code))}
          // Lookups for the Category quick-create mini-child (Levy picker +
          // item-class-scoped create).
          levies={levies}
          fabricStructures={all.filter((l) => l.kind === "fabric_structure")}
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
      const [compositions, all, categories, levies] = await Promise.all([
        listCompositions(),
        listConfigLookups(),
        listCategories(),
        listLevies(),
      ]);
      // The HEADER is Fabric and the LINES are Yarn (0384) — a composition
      // belongs to a fabric, and its mixing lines name the yarns inside it.
      const yarnClass = all.find((l) => l.kind === "item_class" && l.code?.toUpperCase() === "YARN");
      screen = (
        <CompositionMasterScreen
          rows={compositions}
          // Composition (fibre mixing %) only ever applies to Fabric — never
          // the full item-class list (Yarn, Pack, Sew, Garments, …).
          itemClasses={all.filter((l) => l.kind === "item_class" && l.code === "FABRIC")}
          yarnClassId={yarnClass?.id ?? null}
          // Scoped here, not in the screen: the cascading-picker rule puts the
          // narrowing at the caller that knows the parent class.
          yarnCategories={categories.filter((c) => c.item_class_id === yarnClass?.id)}
          // Lookups for the Category quick-create mini-child behind "+ Add".
          levies={levies}
          fabricStructures={all.filter((l) => l.kind === "fabric_structure")}
          perms={perms}
        />
      );
    } else if (child.custom === "materials") {
      const [materials, all, categories, units, hsnRows, materialAttributes, attributeList, levies] =
        await Promise.all([
          listMaterials(),
          listConfigLookups(),
          listCategories(),
          listUoms(),
          listHsnDetails(),
          listMaterialAttributes(),
          listAttributes(),
          listLevies(),
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
          levies={levies}
          perms={perms}
        />
      );
    } else if (child.custom === "processes") {
      const processes = await listProcesses();
      screen = <ProcessMasterScreen rows={processes} perms={perms} />;
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
    } else if (child.custom === "bins") {
      const [rows, locations] = await Promise.all([listBins(), listEmployeeLocations()]);
      screen = <BinMasterScreen rows={rows} locations={locations} perms={perms} />;
    } else if (child.custom === "garment_rejection_rules") {
      const rows = await listGarmentRejectionRules();
      screen = <GarmentRejectionRuleMasterScreen rows={rows} perms={perms} />;
    // --- Phase 1: Simple masters (rows + perms only) ---
    } else if (child.custom === "defect_groups") {
      const rows = await listDefectGroupsSimple();
      screen = <DefectGroupMasterScreen rows={rows} perms={perms} />;
    // --- Phase 1: Dedicated masters ---
    } else if (child.custom === "defect_details") {
      const [rows, defectGroups] = await Promise.all([listDefectDetails(), listDefectGroups()]);
      screen = <DefectDetailMasterScreen rows={rows} defectGroups={defectGroups} perms={perms} />;
    } else if (child.custom === "item_class") {
      // listAttributes(), not listItemClasses(): same table, same filter, one
      // join more — it brings each class's attribute values along so the view
      // sheet can answer "which attributes?" without a second query.
      const rows = await listAttributes();
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
